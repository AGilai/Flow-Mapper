#!/usr/bin/env bash
# For the account owner (an IAM admin). PRINTS the commands of the one-time flows bootstrap; it runs nothing and calls no AWS API.
#
#   infra/bootstrap.sh [--region eu-central-1] [--principal kehilot-deployer] [--stack flows-bootstrap] [--domain-zone ZONEID]
#
# --domain-zone also allows ACM and one Route 53 zone for a custom domain (needs --region us-east-1). See docs/OPERATIONS.md.
set -euo pipefail

REGION=eu-central-1; ROLE=kehilot-deployer; STACK=flows-bootstrap; ZONE=
while [ $# -gt 0 ]; do
  case $1 in
    --region) REGION=$2; shift 2 ;; --principal) ROLE=$2; shift 2 ;; --stack) STACK=$2; shift 2 ;; --domain-zone) ZONE=$2; shift 2 ;;
    -h|--help) sed -n 2,6p "$0"; exit 0 ;;
    *) echo "bootstrap: unknown argument $1" >&2; exit 2 ;;
  esac
done
PARAMS="FlowsRegion=$REGION"
[ -z "$ZONE" ] || PARAMS="$PARAMS EnableDomain=true DomainHostedZoneId=$ZONE"

cat <<EOF2
Run these as an IAM administrator (not as the deploy role). Run from the repo root. Review infra/flows-bootstrap.yaml first.

# 1. Create the permissions boundary, the CloudFormation service role and the deployer policy
aws cloudformation deploy --region $REGION --stack-name $STACK \\
  --template-file infra/flows-bootstrap.yaml \\
  --capabilities CAPABILITY_NAMED_IAM --tags Project=flows \\
  --parameter-overrides $PARAMS

# 2. See the ARNs
aws cloudformation describe-stacks --region $REGION --stack-name $STACK --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text

# 3. Attach the deployer policy to the machine's deploy role (only an IAM admin can do this)
ACCOUNT=\$(aws sts get-caller-identity --query Account --output text)
aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::\$ACCOUNT:policy/flows-deployer
EOF2
