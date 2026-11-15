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
#   --dry-run                print the command and stop
set -euo pipefail

STACK=flows; REGION=${AWS_REGION:-}; ADMIN=; TAG=; TYPE=t4g.small; DOMAINS=; REPO_URL=; KEY=; PREFIX=; DOMAIN=; ZONE=; VPC=; SUBNET=; DRY=0
while [ $# -gt 0 ]; do
  case $1 in
    --stack) STACK=$2; shift 2 ;; --region) REGION=$2; shift 2 ;; --admin-email) ADMIN=$2; shift 2 ;; --repo-tag) TAG=$2; shift 2 ;;
    --instance-type) TYPE=$2; shift 2 ;; --allowed-domains) DOMAINS=$2; shift 2 ;; --repo-url) REPO_URL=$2; shift 2 ;;
    --key-secret-arn) KEY=$2; shift 2 ;; --hosted-ui-prefix) PREFIX=$2; shift 2 ;; --domain) DOMAIN=$2; shift 2 ;; --zone) ZONE=$2; shift 2 ;;
    --vpc) VPC=$2; shift 2 ;; --subnet) SUBNET=$2; shift 2 ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,17p "$0"; exit 0 ;;
    *) echo "deploy: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$ADMIN" ] && [ -n "$TAG" ] || { echo "deploy: --admin-email and --repo-tag are required (see --help)" >&2; exit 2; }
if [ -z "$REGION" ]; then REGION=$(aws configure get region || true); fi
[ -n "$REGION" ] || { echo "deploy: no region (use --region)" >&2; exit 2; }
if [ -n "$DOMAIN" ] && [ "$REGION" != us-east-1 ]; then echo "deploy: a custom domain needs --region us-east-1 (CloudFront certificates live there)" >&2; exit 2; fi

HERE=$(cd "$(dirname "$0")" && pwd)
PL=$(aws ec2 describe-managed-prefix-lists --region "$REGION" \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)
[ -n "$PL" ] && [ "$PL" != None ] || { echo "deploy: CloudFront prefix list not found in $REGION" >&2; exit 1; }

cmd=(aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file "$HERE/flow-mapper.yaml"
  --capabilities CAPABILITY_IAM --tags Project=flows --no-fail-on-empty-changeset
  --parameter-overrides "RepoTag=$TAG" "AdminEmail=$ADMIN" "InstanceType=$TYPE" "CloudFrontPrefixListId=$PL"
  "AllowedEmailDomains=$DOMAINS" "RepoUrl=$REPO_URL" "GitHubDeployKeySecretArn=$KEY" "HostedUiDomainPrefix=$PREFIX"
  "DomainName=$DOMAIN" "HostedZoneId=$ZONE" "VpcId=$VPC" "SubnetId=$SUBNET")
echo "deploy: ${cmd[*]}"
[ "$DRY" = 1 ] && exit 0
"${cmd[@]}"

echo; echo "Outputs:"
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
POOL=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" --output text)
INST=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
cat <<EOF

First admin ($ADMIN):
  1. Cognito emailed a temporary password to $ADMIN. Open the Url above and sign in; you are asked to set a new password.
  2. Not received? Set one yourself:
       aws cognito-idp admin-set-user-password --region $REGION --user-pool-id $POOL --username $ADMIN --password '<new password>' --permanent
  3. More users: aws cognito-idp admin-create-user --region $REGION --user-pool-id $POOL --username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true
  4. Server shell (no SSH): aws ssm start-session --region $REGION --target $INST
  5. The instance installs itself at first boot (about 5 minutes). Check: curl <Url>/healthz
EOF
