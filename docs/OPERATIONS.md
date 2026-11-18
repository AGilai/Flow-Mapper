# Operations: running Flow-Mapper on AWS

Plan: [plans/aws-v1.md](plans/aws-v1.md). One EC2 instance runs the server (SQLite on its own EBS volume) and Litestream (continuous copy to S3). CloudFront gives it HTTPS, Cognito holds the accounts (the app side lands with part C of the plan). Files: `deploy/` (on the instance), `infra/` (the CloudFormation stack).

## Login: `FLOW_AUTH`
A fresh install runs with `FLOW_AUTH=off`: the app has no login of its own, so anyone with the URL reads and changes everything. CloudFront serves it to the whole internet, so the stack puts HTTP basic auth (user `flows`, `PreAuthPassword`) at CloudFront in front of every path until you switch to Cognito. `infra/deploy.sh` generates the password for a new stack and prints it at the end; `--gate-password` sets your own; `--open` removes the gate and prints a warning. The CloudFront-to-instance hop is plain HTTP and any CloudFront distribution can reach port 80 through the prefix list, so the gate is not a strong boundary. Switch to Cognito (below) before real data goes in.

### Switching to Cognito login (0.52.0)
1. The instance already has `FLOW_COGNITO_ISSUER`, `FLOW_COGNITO_CLIENT_ID`, `FLOW_COGNITO_DOMAIN`, `FLOW_PUBLIC_URL`, `FLOW_ADMIN_EMAIL` (from the stack's SSM parameter, written by `install.sh`) and `FLOW_ORIGIN_SECRET` (from the SecureString `/flows/<stack>/origin-secret`). Check: `sudo grep -c FLOW_ /etc/flow-mapper.env` (the file is mode 600).
2. Remove the CloudFront gate, because it uses the `Authorization` header that bearer tokens need: redeploy with `infra/deploy.sh --open` (the app now does the authentication). Do this in the same sitting as step 3.
3. `sudo sed -i 's/^FLOW_AUTH=.*/FLOW_AUTH=cognito/' /etc/flow-mapper.env && sudo systemctl restart flow-mapper`. The server refuses to start in cognito mode when an issuer, client id, domain or public URL is missing (see `journalctl -u flow-mapper`).
4. Open the site and sign in with the admin user the stack created (its first-login password: the commands `deploy.sh` printed). **The first user who signs in with the email in `FLOW_ADMIN_EMAIL` (the stack's `AdminEmail`) becomes an admin**; others sign in as normal users, and an admin cannot be made from the UI later (set `users.is_admin` in the database).
5. Rolling back: set `FLOW_AUTH=off` and restart (and redeploy with the gate password). Nothing in the database depends on the mode.

**What changes for the existing data.** Migration 020 gives every existing design env no owner and the visibility `published`: everyone who signs in can read it, only admins edit it, and an admin can hand it to an owner (`PUT /api/envs/:env/access {"owner": "<user id>"}`). Harvested (sealed) envs are readable by everyone signed in. New designs are private to their creator. Users made before the switch (names only) stay; a person who signs in gets a new user (their display name, or with their email when the name is taken). Merge the two on the Users page if you want the old history under the new account (admins only).

### Inviting people (CR #134)
Admins: user menu, **Invite people**: paste e-mail addresses, send; each gets Cognito's invitation e-mail (the stack's `InviteMessageTemplate`). The list below shows who is in the pool; **Resend** is offered for people who never signed in (`FORCE_CHANGE_PASSWORD`). Needs `FLOW_COGNITO_USER_POOL_ID` (the stack writes it to the app-env parameter; a server that only has `FLOW_COGNITO_ISSUER` derives it) and the instance role's `cognito-idp:AdminCreateUser`, `AdminGetUser`, `ListUsers` on the pool (in `flow-mapper.yaml`). **Existing deployments:** redeploy `flows-bootstrap.yaml` first (the permissions boundary gets the same three actions, otherwise the role is capped), then the stack. The `aws cognito-idp admin-create-user` command `deploy.sh` prints still works.

### Tokens for harvesters and agents
A person creates a personal access token under **Tokens** in the UI (name, optional expiry of 30, 90 or 365 days, default never). **Harvesters need a token created by an admin with Harvester ticked**: without that scope a write to a sealed env is `403 SEALED`. Harvesters send `Authorization: Bearer fm_...` (see [HARVESTER-GUIDE.md](HARVESTER-GUIDE.md)); agents put it in the MCP config (the Tokens page shows the snippet). An expired token answers `401 TOKEN_EXPIRED` and names itself: create a new one and replace it. Revoke a token on the same page; the list shows when each was last used.

### Trying cognito mode without AWS
`tests/fake-idp.ts` is a stand-in for Cognito (test and QA use only): `node tests/fake-idp.ts 3542` serves a JWKS, an auto-approving authorize page, the token and logout endpoints. Run a scratch server against it: `FLOW_AUTH=cognito FLOW_COGNITO_ISSUER=<base>/pool FLOW_COGNITO_DOMAIN=<base> FLOW_COGNITO_CLIENT_ID=test-client FLOW_PUBLIC_URL=http://localhost:3541 FLOW_ADMIN_EMAIL=admin@example.com FLOW_DB=/tmp/x/a.db FLOW_DATA_DIR=/tmp/x PORT=3541 node --disable-warning=ExperimentalWarning server/main.ts`; `curl -d '{"email":"admin@example.com","name":"Admin"}' <base>/__user` picks who the next sign-in is.

## Choices worth knowing
- **Port 80.** The service listens on `0.0.0.0:80` as the unprivileged user `flowmapper` (`AmbientCapabilities=CAP_NET_BIND_SERVICE`). CloudFront reaches it over HTTP on port 80; the security group admits only CloudFront's origin-facing managed prefix list, so the plain-HTTP hop is not open to the internet. No SSH, no port 22.
- **Prefix list.** The template takes its ID as a parameter (`CloudFrontPrefixListId`); a template cannot look it up. `infra/deploy.sh` finds it with `aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing`. The list counts as 55 rules against the security group quota (60 by default): do not add more rules to that group.
- **Cognito vs CloudFront circularity.** The instance is the CloudFront origin, the Cognito client needs the CloudFront domain for its callback URL, and the instance wants the client id. The stack breaks the loop by giving the instance no Cognito values in user data: it writes them to the SSM parameter `/flows/<stack>/app-env`, and `deploy/install.sh` reads that parameter at boot (after the app is up; it retries for 30 minutes while CloudFront finishes deploying, and restarts the app if the values changed). A custom `DomainName` is not needed.
- **Custom domain.** CloudFront takes certificates from us-east-1 only, so with `DomainName` set the stack must be deployed in us-east-1 (a template rule and `deploy.sh` enforce it). Without a domain, use any region.
- **Tags.** Every resource carries `Project=flows` and a `flows-...` name (`flows-app`, `flows-data`, `flows-users`, `flows-<account>-<region>-data` for the bucket). The stack itself is tagged by `deploy.sh` (`--tags Project=flows`), snapshots get `Project=flows` through the DLM policy. For cost reports, activate `Project` as a cost allocation tag once (Billing console, Cost allocation tags; it takes up to 24 hours to show). Resources without tag support (instance profile, Cognito client and domain, cache policy, volume attachment) are named `flows-...` or follow their stack.
- **Stop/start is safe.** The instance has an Elastic IP (`flows-eip`) and the CloudFront origin is that address's public DNS name (`ec2-a-b-c-d.compute-1.amazonaws.com` in us-east-1, `ec2-a-b-c-d.<region>.compute.amazonaws.com` elsewhere), so stopping the instance at night and starting it in the morning keeps CloudFront working: the address stays attached while the instance is stopped. Without it the public DNS name would change on every start. The security group, DNS and cache need no action; the app is back once systemd starts it (check `/healthz`). The Elastic IP is billed even while the instance is stopped (below).
- **Origin header.** CloudFront adds `X-Flows-Origin: <secret>` to every request to the instance (stack parameter `OriginSecret`). With `FLOW_AUTH` either way the app rejects requests without it (403 `FORBIDDEN_ORIGIN`) once `FLOW_ORIGIN_SECRET` is in `/etc/flow-mapper.env`, because port 80 is open to every CloudFront distribution, not only this one; `/healthz` is exempt so the local health checks work. `install.sh` reads the SecureString into that file (mode 600) when it runs. The secret is stable: `deploy.sh` generates it for a new stack, keeps it on every redeploy by reading the SecureString `/flows/<stack>/origin-secret` (CloudFormation cannot create SecureStrings, so `deploy.sh` writes it with `aws ssm put-parameter --type SecureString --overwrite` after the deploy), and rotates it only with `--origin-secret S`. The instance role may `ssm:GetParameter` that one name and `kms:Decrypt` through the `aws/ssm` key (`kms:ViaService` = `ssm.<region>.amazonaws.com`). After a rotation, run `sudo /opt/flow-mapper/deploy/install.sh` (or set `FLOW_ORIGIN_SECRET` in the env file by hand) and restart the app: the value is read once at startup.
- **Stack recreate.** The bucket is retained when the stack is deleted, and its name is fixed (`flows-<account>-<region>-data`): create the new stack after deleting the empty old bucket, or restore into it. Lambda, log group and hosted UI domain names are also fixed, so one stack per account and region.
- **Instance size.** Default `t4g.small` (2 vCPU burstable, 2 GB). Allowed: `t4g.micro`, `t4g.small`, `t4g.medium`. `t4g.micro` (1 GB) is too small for the graph cache; use `small`, or `medium` when RSS grows with big graphs (`FLOW_GRAPH_CACHE_*` below). The unit caps the process at 1.7 GB.

## Settings (environment variables)
On the instance they live in `/etc/flow-mapper.env` (read by both systemd units). Locally you export them.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 (the unit sets 80) | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `FLOW_DATA_DIR` | `<repo>/data` (the unit sets `/var/lib/flow-mapper`) | Data directory (database, exports) |
| `FLOW_DB` | `<data dir>/flow-mapper.db` | Database file |
| `FLOW_GRAPH_CACHE_MAX` | 8 | Environments whose resolved graph stays cached (LRU) |
| `FLOW_GRAPH_CACHE_ITEMS` | 150000 | Weight budget of that cache (about 140 MB RSS per 1,000-service graph) |
| `FLOW_BODY_CACHE_MB` | 64 | Budget of kept JSON response bodies |
| `NODE_ENV` | (the unit sets `production`) | Anything but `production` is dev mode |
| `FLOW_BACKUP_BUCKET` | from the stack | S3 bucket for Litestream (used by `litestream.yml` and `install.sh`) |
| `AWS_REGION` | from the stack | Region of that bucket |
| `FLOW_REPO_TAG`, `FLOW_REPO_URL`, `FLOW_DEPLOY_KEY_SECRET_ARN`, `FLOW_PARAM_NAME` | from the stack | Read by `install.sh` and `upgrade.sh` only |
| `FLOW_AUTH` | `off` | `off` or `cognito` (0.52.0). The stack and `install.sh` write `off`; see "Switching to Cognito login" |
| `FLOW_COGNITO_USER_POOL_ID` | from the stack | The user pool for the Invite people page; optional, derived from the issuer when unset |
| `FLOW_COGNITO_ISSUER`, `FLOW_COGNITO_CLIENT_ID`, `FLOW_COGNITO_DOMAIN`, `FLOW_PUBLIC_URL` | from the stack | The Cognito issuer (JWKS at `<issuer>/.well-known/jwks.json`), app client id (public client, no secret), hosted UI base URL, and the public https URL (the callback is `<url>/auth/callback`). Required when `FLOW_AUTH=cognito` |
| `FLOW_ADMIN_EMAIL` | from the stack (`AdminEmail`) | The first user who signs in with this email becomes an admin |
| `FLOW_ORIGIN_SECRET` | from SSM `/flows/<stack>/origin-secret` | When set, requests without `X-Flows-Origin: <secret>` get 403 (except `/healthz`) |

After editing the file: `sudo systemctl restart flow-mapper`.

## Install
1. Pick a release tag. A private repo needs a read-only deploy key: store the private key as a plain-text Secrets Manager secret and pass its ARN (`--key-secret-arn`). Without a key the instance clones over HTTPS.
2. (After the bootstrap above.) `infra/deploy.sh --admin-email you@example.com --repo-tag v0.52.0` (see `--help`; this creates AWS resources, with the CLI's credentials). It prints the outputs (URL, Cognito issuer and client id, hosted UI domain, bucket, instance id) and the first-admin steps.
3. At first boot, user data writes `/etc/flow-mapper.env`, clones the repo and runs `deploy/install.sh`: it installs the pinned Node (22.21.1, official tarball, checksum verified) and Litestream (0.3.13 `.deb`, arm64 or amd64), creates the user, formats and mounts the data volume at `/var/lib/flow-mapper` (label `flowdata`, fstab), checks out the tag, **restores the database from S3 if a replica exists**, creates an empty database otherwise, and starts both units, then waits for the SSM parameter. Allow about five minutes, then `curl https://<url>/healthz` returns `{"ok":true,"version":"..."}`.
4. `install.sh` is idempotent and also runs by hand (`sudo deploy/install.sh --dry-run --tag v0.52.0 --bucket B --region R` prints the steps and changes nothing).

### One-time bootstrap (IAM admin)
The account is shared with another project, so the machine that runs `deploy.sh` has no IAM or broad rights. Before the first deploy the account owner (an IAM admin) runs the bootstrap once. `infra/bootstrap.sh` only prints the commands; read `infra/flows-bootstrap.yaml` first, then run, in this order:
1. `aws cloudformation deploy --region eu-central-1 --stack-name flows-bootstrap --template-file infra/flows-bootstrap.yaml --capabilities CAPABILITY_NAMED_IAM --tags Project=flows --parameter-overrides FlowsRegion=eu-central-1` (`FlowsRegion` is the one region flows runs in; a custom domain needs `us-east-1` and `EnableDomain=true DomainHostedZoneId=<zone>`, off by default).
2. `aws cloudformation describe-stacks --stack-name flows-bootstrap --query 'Stacks[0].Outputs'` shows `ServiceRoleArn`, `DeployerRoleArn`, `DeployerPolicyArn`, `BoundaryArn`.
3. Let the deploy machine assume `flows-deployer-role`. On this account the machine's role is `kehilot/kehilot-deployer`, which has its own permissions boundary (`kehilot-boundary`); add one statement to that boundary **and** to its permissions: `{"Effect":"Allow","Action":"sts:AssumeRole","Resource":"arn:aws:iam::<account>:role/flows-deployer-role"}`. Only an admin can do this. Do not attach `flows-deployer` to the machine's role: it lives on `flows-deployer-role` only, so all its guards stay in one place.
4. On the machine, `~/.aws/config`:
   ```
   [profile flows]
   role_arn = arn:aws:iam::<account>:role/flows-deployer-role
   credential_source = Ec2InstanceMetadata
   region = eu-central-1
   ```
After that `AWS_PROFILE=flows infra/deploy.sh …` works. It finds `arn:aws:iam::<account>:role/flows-cfn-service-role` itself (`--cfn-role` overrides) and passes it as `--role-arn`, so CloudFormation, not the deploy role, creates the resources. The stack must be named `flows` or `flows-*` (not `flows-bootstrap`). Re-run step 1 when the bootstrap template changes; it never needs to run for a normal flows deploy or upgrade.

### Permission model
| Piece | Can do | Cannot do |
|---|---|---|
| `flows-deployer-role` with the `flows-deployer` policy (assumed only by `kehilot/kehilot-deployer`, 1 h sessions) | CloudFormation Create/Update/Delete stack and change sets on `stack/flows/*` and `stack/flows-*/*`, only with `cloudformation:RoleArn` = the service role; `iam:PassRole` of that one role (to cloudformation); `ssm` get/put on `/flows/*` plus `kms` only via SSM; describe instances and prefix lists; stop/start instances tagged `Project=flows` (replaces `flows-power-policy.json`) | Anything else; touch the `flows-bootstrap` stack (explicit deny) |
| `flows-cfn-service-role` (CloudFormation assumes it; trusts only CloudFormation for `flows` stacks) | IAM only on `role/flows-*` and `instance-profile/flows-*`; create, put-policy, attach and update-trust only with `iam:PermissionsBoundary` = the boundary, attach only the three AWS managed policies the stack uses; pass roles only to ec2, dlm and lambda; EC2 create with request tag `Project=flows`, change/terminate with resource tag; S3 bucket configuration on `flows-*`; CloudFront, Cognito, DLM by tag or name; Lambda and Logs by `flows-*`; SSM write only on `/flows/*` | Raise rights: explicit denies on edits to the boundary, `flows-deployer` and `flows-cfn-*` policies (new versions, delete), on any IAM write against itself, `role/kehilot*` and `policy/kehilot*`, on removing or changing a boundary and on creating a role without it; no `kms` rights; no ACM/Route 53 unless the bootstrap enabled the domain |
| `flows-permissions-boundary` (on every role the stack creates) | The ceiling: S3 `flows-*`, SSM `GetParameter` on `/flows/*`, `kms:Decrypt` only via SSM, Session Manager core, logs for `flows-*`, DLM snapshot actions on `Project=flows`, deploy-key secret `flows-*` | Everything else, whatever a template says |
Every role in `flow-mapper.yaml` is named `flows-<stack>-...` and carries the boundary (parameter `PermissionsBoundaryArn`, default the ARN of `flows-permissions-boundary`).

Things the service role cannot scope by name or tag (all documented in comments in `flows-bootstrap.yaml`): CloudFront `CreateCachePolicy` (no name or tag at create; cache policies are addressed by generated id, so change/delete cannot be scoped either). `cloudfront:CreateFunction` is scoped to `function/flows-*`; if the first deploy hits AccessDenied on it, move it back to the unscoped statement in `flows-bootstrap.yaml`; `cognito-idp:DescribeUserPoolDomain`, `logs:DescribeLogGroups`, `dlm:GetLifecyclePolicies`, `ssm:DescribeParameters` (read-only lists); `ec2:CreateSecurityGroup` on `vpc/*`, RunInstances on `image`, `subnet` and `network-interface`, AssociateAddress on `network-interface` (untagged by nature, the tagged resource is still required in the same call). The first-admin steps that `deploy.sh` prints (`cognito-idp admin-set-user-password`, `admin-create-user`) need Cognito rights that `flows-deployer` does not grant: run them as admin.

Open exposure (what the service role can still reach beyond flows, accepted and known):
- Cache policies (`cache-policy/*`) of any project can be edited or deleted: they have no tags and are addressed by generated id.
- Untagged CloudFront distributions: `CreateDistributionWithTags` makes CloudFront check `cloudfront:TagResource`, so the role may add `Project=flows` to a distribution that has no Project tag, and then control it. Distributions that already carry another project's tag are protected by an explicit Deny on Tag/Untag (`Null` on `aws:ResourceTag/Project` is false and the value is not `flows`). Tag every other project's distributions.
- Trust policies of new `flows-*` roles are not restricted (`iam:UpdateAssumeRolePolicy` takes no boundary condition). The boundary still limits what such a role can do to flows data.
- Create statements carry no `TagResource` for Cognito, DLM or ACM (tags go in the create call), and each has the same Deny against another project's tag, as defence in depth. Kehilot uses a lowercase key (`project=kehilot`); condition key names are case-insensitive, to be verified on the first run.
- `flows-deployer` (Run Command): `ssm:GetCommandInvocation` / `ListCommandInvocations` take no instance scope, so the deployer can read the output of Run Command invocations on any instance in the account, Kehilot's included. Command output can contain secrets: don't print secrets in Run Command scripts on any instance.
- `flows-deployer` has root on flows instances through `AWS-RunShellScript`, so it effectively holds the instance role's rights too (the flows bucket, `/flows/*` parameters).

First deploy (2026-11-15), resolved:
- `ExecuteChangeSet` carries no `cloudformation:RoleArn` key: it is now its own unconditioned statement on the flows stacks (`ExecuteOwnChangeSets`).
- Stack tags reach the CloudFront function: Tag/Untag/ListTags on `function/flows-*` added. `CreateFunction` scoped by name works.

Still to verify:
- That the lowercase-`project` Deny matches, and `aws:RequestTag` on `CreateDistribution`, `CreateUserPool`, `CreateLifecyclePolicy` (and `RequestCertificate` with a domain).

## Upgrade and roll back
- Upgrade: `sudo deploy/upgrade.sh v0.52.1` (through SSM, below). It checks out the tag, refreshes the unit files, restarts both services and waits for `/healthz`. It prints the previous tag.
- Roll back code: `sudo deploy/upgrade.sh <previous tag>`.
- Migrations run at startup, take a backup `flow-mapper.db.pre-NNN.bak` in the data directory first, and only go forward. If a rollback crosses a migration, the older code refuses the newer schema: stop the service, restore the database as below (point in time before the upgrade, or the `.pre-NNN.bak` file), then run `upgrade.sh <old tag>`.
- To change the tag the stack installs for a replacement instance, update the stack with a new `RepoTag`. That replaces the instance (user data changes), the data volume is detached and reattached, and the database is read from the volume. Prefer `upgrade.sh` for routine releases.

## Backups and the restore drill
Two independent copies: Litestream streams every write to `s3://<bucket>/litestream/flow-mapper` (about one second behind, snapshots every 6 hours, 7 days of history; the bucket is versioned and expires old versions after 14 days), and DLM takes an EBS snapshot of the data volume nightly at 01:00 UTC and keeps 7.

Drill 1, Litestream, to a point in time (do this on a scratch machine or into a scratch directory, not over the live database):
```
sudo -u flowmapper env AWS_REGION=<region> FLOW_BACKUP_BUCKET=<bucket> \
  litestream restore -config /etc/litestream.yml -timestamp 2026-11-20T09:30:00Z -o /tmp/restore-test.db /var/lib/flow-mapper/flow-mapper.db
sqlite3 /tmp/restore-test.db 'PRAGMA integrity_check; select count(*) from envs;'
```
`litestream generations` and `litestream snapshots` list what is available. To restore for real: `sudo systemctl stop litestream flow-mapper`, move the database and its `-wal` / `-shm` files aside, run the restore with `-o` the live path (or without `-o`), `chown flowmapper:flowmapper`, start both services. Litestream starts a new generation after a restore.

Drill 2, EBS snapshot: find the latest snapshot of `flows-data` (EC2 console, Snapshots, filter `Project=flows`), create a volume from it in the instance's availability zone, attach it to a scratch instance (or to this one as `/dev/sdg`), mount read-only and run `sqlite3 <mount>/flow-mapper.db 'PRAGMA integrity_check'`. To replace the live volume: stop the services, detach the old volume, attach the new one as `/dev/sdf` (the label `flowdata` makes the mount find it after a reboot or `sudo mount -a`), start the services.

Repeat a drill after the first deploy and after any change to the backup settings. A backup that was never restored is not known to work.

## Loading an existing database file
Copy the file in with the services stopped, then let Litestream take over:
```
aws s3 cp flow-mapper.db s3://<bucket>/import/flow-mapper.db        # from your machine
# on the instance (SSM shell):
sudo systemctl stop litestream flow-mapper
sudo -u flowmapper aws s3 cp s3://<bucket>/import/flow-mapper.db /var/lib/flow-mapper/flow-mapper.db   # or any other copy method
sudo systemctl start flow-mapper                                      # migrations upgrade it in place, with a .pre-NNN.bak
sudo systemctl start litestream                                       # replicates the loaded file as a new generation
```
Take the source file with `sqlite3 <db> ".backup out.db"` (a plain copy of a live WAL database can be inconsistent). If a replica already exists in S3 from earlier data, the new generation simply becomes the latest one. The data may be real: do not leave copies in the bucket (`s3 rm` the import key, versions expire after 14 days).

## Logs
```
journalctl -u flow-mapper -f              # the app
journalctl -u litestream -f               # replication
journalctl -u flow-mapper --since '1 hour ago' -p warning
sudo journalctl -u cloud-final            # first-boot user data and install.sh output
```
Journald is on the root volume with the default limits. CloudFront logging is not enabled.

## Connect over SSM (no SSH)
`aws ssm start-session --region <region> --target <instance id>` (needs the Session Manager plugin for the AWS CLI). Port forward for a look at the app that bypasses CloudFront: `aws ssm start-session --target <id> --document-name AWS-StartPortForwardingSession --parameters portNumber=80,localPortNumber=8080`, then `http://localhost:8080`.

## CloudFront and the event stream
`/api/events` is Server-Sent Events. It passes through the `/api/*` behaviour with caching disabled and no compression, and CloudFront streams the response as it arrives. The origin read timeout is the longest silence CloudFront accepts from the origin: 60 seconds is the default maximum without a quota increase (`OriginReadTimeout: 60` in the template; more needs a Service Quotas request). The server sends a heartbeat comment every 25 seconds, so streams stay open; do not raise `heartbeatMs` above about 50 seconds. CloudFront also ends a connection that stays open very long, and the browser reconnects with `Last-Event-ID`. Static files (everything outside `/api/*`, `/mcp*`, `/auth/*`, `/healthz`) are cached for 60 seconds by default, at most one hour. Part C needed no behaviour change: the SPA shell and its files are public and cookie-independent (the sign-in state is fetched from `/api/me`), so the default behaviour keeps ignoring cookies and stays cached; the session and CSRF cookies matter only on `/api/*`, `/mcp*` and `/auth/*`, which have caching disabled and forward every cookie (`AllViewerExceptHostHeader`).

## Cost estimate
Monthly, one instance, small team, a US region, on-demand (**verify current prices at deploy time; these are rounded and from memory**):

| Item | About |
|---|---|
| t4g.small, always on | US$12 |
| Elastic IP (public IPv4 is billed hourly, about US$3.6, also while the instance is stopped) | US$4 |
| Root 12 GB + data 20 GB gp3 | US$3 |
| Snapshots (7, incremental, small DB) | US$0.5 to 1 |
| S3 (a few GB, requests from Litestream) | US$1 to 3 |
| CloudFront (free tier covers a team) | US$0 to 2 |
| Cognito (free for the first 10,000 monthly active users) | US$0 |
| **Total** | **about US$20 to 25** |

A `t4g.medium` roughly doubles the instance line. Billing is per `Project=flows` tag (see Tags). To stop spending: delete the stack (the bucket and the final data snapshot are retained on purpose; delete them by hand when you are sure).
