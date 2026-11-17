#!/usr/bin/env bash
# Deploys infra/flow-mapper.yaml with the AWS CLI. This CREATES AWS resources and costs money: read docs/OPERATIONS.md first.
#
#   infra/deploy.sh --admin-email you@example.com --repo-tag v0.52.0 [options]
#
# Options (all but the first two are optional):
#   --stack NAME             stack name (default flows)
#   --region REGION          default $AWS_REGION, else the CLI profile's region
#   --instance-type T        t4g.micro | t4g.small (default) | t4g.medium
#   --allowed-domains a.com,b.com   email domains that may sign themselves up (default: admin-created users only)
#   --repo-url URL           default: the GitHub repo (SSH form when --key-secret-arn is given)
#   --key-secret-arn ARN     Secrets Manager secret with a read-only SSH deploy key (private repo)
#   --hosted-ui-prefix P     Cognito hosted UI domain prefix (default flows-<account id>)
#   --domain D --zone ZONE   custom domain and its Route 53 zone id (the stack must then be in us-east-1)
#   --vpc ID --subnet ID     instead of the default VPC (the subnet must auto-assign public IPv4)
#   --gate-password PW      basic-auth password (user "flows", 12+ characters) in front of the whole site at CloudFront. A NEW stack gets a
#                            generated one unless you pass this or --open. An existing stack keeps its current one.
#   --open                   no gate: until part C (Cognito login in the app) the app has NO authentication, so this makes
#                            the site, its data and its write API open to anyone who has the URL
#   --origin-secret S        value of the X-Flows-Origin header (rotates it; default: kept from SSM, generated for a new stack)
#   --cfn-role ARN           CloudFormation service role (default: arn:aws:iam::<account>:role/flows-cfn-service-role from infra/flows-bootstrap.yaml)
#   --boundary ARN           permissions boundary for the stack's roles (default: the stack's own default, flows-permissions-boundary)
#   --dry-run                print the command and stop
set -euo pipefail

STACK=flows; REGION=${AWS_REGION:-}; ADMIN=; TAG=; TYPE=t4g.small; DOMAINS=; REPO_URL=; KEY=; PREFIX=; DOMAIN=; ZONE=; VPC=; SUBNET=; DRY=0; GATEPW=; OPEN=0; OSECRET=; CFNROLE=; BOUNDARY=
while [ $# -gt 0 ]; do
  case $1 in
    --stack) STACK=$2; shift 2 ;; --region) REGION=$2; shift 2 ;; --admin-email) ADMIN=$2; shift 2 ;; --repo-tag) TAG=$2; shift 2 ;;
    --instance-type) TYPE=$2; shift 2 ;; --allowed-domains) DOMAINS=$2; shift 2 ;; --repo-url) REPO_URL=$2; shift 2 ;;
    --key-secret-arn) KEY=$2; shift 2 ;; --hosted-ui-prefix) PREFIX=$2; shift 2 ;; --domain) DOMAIN=$2; shift 2 ;; --zone) ZONE=$2; shift 2 ;;
    --vpc) VPC=$2; shift 2 ;; --subnet) SUBNET=$2; shift 2 ;; --gate-password) GATEPW=$2; shift 2 ;; --open) OPEN=1; shift ;; --origin-secret) OSECRET=$2; shift 2 ;; --cfn-role) CFNROLE=$2; shift 2 ;; --boundary) BOUNDARY=$2; shift 2 ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,22p "$0"; exit 0 ;;
    *) echo "deploy: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$ADMIN" ] && [ -n "$TAG" ] || { echo "deploy: --admin-email and --repo-tag are required (see --help)" >&2; exit 2; }
if [ -z "$REGION" ]; then REGION=$(aws configure get region || true); fi
[ -n "$REGION" ] || { echo "deploy: no region (use --region)" >&2; exit 2; }
if [ -n "$DOMAIN" ] && [ "$REGION" != us-east-1 ]; then echo "deploy: a custom domain needs --region us-east-1 (CloudFront certificates live there)" >&2; exit 2; fi

# CloudFormation acts through the flows service role (created once by an IAM admin: infra/bootstrap.sh). The deploy role may pass only that role.
if [ -z "$CFNROLE" ]; then
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  CFNROLE="arn:aws:iam::$ACCOUNT:role/flows-cfn-service-role"
fi

HERE=$(cd "$(dirname "$0")" && pwd)
PL=$(aws ec2 describe-managed-prefix-lists --region "$REGION" \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)
[ -n "$PL" ] && [ "$PL" != None ] || { echo "deploy: CloudFront prefix list not found in $REGION" >&2; exit 1; }

# The app has no login until part C: gate the site by default (see PreAuthPassword in the template).
# Secret for the X-Flows-Origin header CloudFront sends (part C makes the app require it). It must NOT change on a redeploy, or the app would
# be locked out until the instance had the new value. Source of truth: the SecureString /flows/<stack>/origin-secret.
# New stack (or no parameter yet): generate. Existing: reuse it. --origin-secret S rotates explicitly.
OPARAM="/flows/$STACK/origin-secret"; WRITE_SECRET=0
if [ -n "$OSECRET" ]; then WRITE_SECRET=1
elif OSECRET=$(aws ssm get-parameter --region "$REGION" --name "$OPARAM" --with-decryption --query Parameter.Value --output text 2>/dev/null) && [ -n "$OSECRET" ]; then :
else OSECRET=$(openssl rand -hex 16); WRITE_SECRET=1; fi
GATE=("OriginSecret=$OSECRET")
if [ "$OPEN" = 1 ] && [ -n "$GATEPW" ]; then echo "deploy: --open and --gate-password exclude each other" >&2; exit 2; fi
if [ "$OPEN" = 1 ]; then GATE+=("PreAuthPassword=")
elif [ -n "$GATEPW" ]; then GATE+=("PreAuthPassword=$GATEPW")
elif ST=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text 2>/dev/null); \
     [ -z "$ST" ] || [ "$ST" = REVIEW_IN_PROGRESS ]; then  # REVIEW_IN_PROGRESS: a create that never ran, it has no gate yet
  GATEPW=$(openssl rand -hex 16); GATE+=("PreAuthPassword=$GATEPW"); echo "deploy: generated a basic-auth password (shown again at the end)"
fi
if [ "$OPEN" = 1 ]; then
  echo "deploy: WARNING: --open removes the CloudFront gate. Only safe once FLOW_AUTH=cognito is on (docs/OPERATIONS.md \"Switching to Cognito login\"); with FLOW_AUTH=off anyone with the URL can read and change all data." >&2
fi

cmd=(aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file "$HERE/flow-mapper.yaml"
  --role-arn "$CFNROLE" --capabilities CAPABILITY_NAMED_IAM --tags Project=flows --no-fail-on-empty-changeset
  --parameter-overrides "RepoTag=$TAG" "AdminEmail=$ADMIN" "InstanceType=$TYPE" "CloudFrontPrefixListId=$PL"
  "AllowedEmailDomains=$DOMAINS" "RepoUrl=$REPO_URL" "GitHubDeployKeySecretArn=$KEY" "HostedUiDomainPrefix=$PREFIX"
  "DomainName=$DOMAIN" "HostedZoneId=$ZONE" "VpcId=$VPC" "SubnetId=$SUBNET" ${GATE[@]+"${GATE[@]}"})
[ -z "$BOUNDARY" ] || cmd+=("PermissionsBoundaryArn=$BOUNDARY")
echo "deploy: ${cmd[*]}" | sed -E 's/(PreAuthPassword=|OriginSecret=)[^ ]+/\1****/g'
[ "$DRY" = 1 ] && exit 0
"${cmd[@]}"
if [ "$WRITE_SECRET" = 1 ]; then
  aws ssm put-parameter --region "$REGION" --name "$OPARAM" --type SecureString --overwrite --value "$OSECRET" --description "flows: X-Flows-Origin header secret" --tags Key=Project,Value=flows >/dev/null 2>&1 \
    || aws ssm put-parameter --region "$REGION" --name "$OPARAM" --type SecureString --overwrite --value "$OSECRET" >/dev/null
  echo "deploy: origin secret stored in SSM $OPARAM"
fi

echo; echo "Outputs:"
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
POOL=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" --output text)
INST=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
echo
echo "ACCESS BEFORE PART C: the app has no login of its own yet."
if [ "$OPEN" = 1 ]; then
  echo "  No CloudFront gate. With FLOW_AUTH=cognito the app asks for a login (API: 401 without a session or token); with FLOW_AUTH=off the site is OPEN to anyone with the Url. Redeploy without --open to add the gate."
elif [ -n "$GATEPW" ]; then
  echo "  The site asks for HTTP basic auth: user  flows  password  $GATEPW  (keep it; it is not shown again)."
else
  echo "  The site asks for HTTP basic auth (user flows, the password set when the stack was created or last changed)."
fi
echo "  Remove the gate only after part C is deployed and FLOW_AUTH=cognito is switched on (infra/deploy.sh --open, or an empty PreAuthPassword)."
cat <<EOF

First admin ($ADMIN), for the Cognito login that part C turns on (no effect on the app yet):
  1. Cognito emailed a temporary password to $ADMIN; you are asked to set a new one at the first Cognito sign-in.
  2. Not received? Set one yourself:
       aws cognito-idp admin-set-user-password --region $REGION --user-pool-id $POOL --username $ADMIN --password '<new password>' --permanent
  3. More users: aws cognito-idp admin-create-user --region $REGION --user-pool-id $POOL --username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true
  4. Server shell (no SSH): aws ssm start-session --region $REGION --target $INST
  5. The instance installs itself at first boot (about 5 minutes). Check: curl <Url>/healthz
EOF
