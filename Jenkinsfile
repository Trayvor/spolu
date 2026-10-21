// Jenkins pipeline for Help by eGrant (code name Spolu) on the company's GitLab, Jenkins and
// Docker registry (ADR 0068, docs/runbooks/deploy.md "Jenkins"). It only calls the scripts: all
// logic lives in scripts/ (ADR 0004).
//
// Only main is built (owner decision 2026-10-21: no CI on merge requests). Every push to main:
//   1. bash scripts/ci.sh           every check, e2e included (about 15 minutes)
//   2. scripts/build-image.sh       pushes $IMAGE:<commit> and $IMAGE:prod to the registry
//   3. scripts/deploy.sh prod       to /opt/spolu/prod on $DEPLOY_HOST, waits for /api/health
// A red step stops the run: nothing is deployed and the previous version keeps running.
// Job type: a plain Pipeline job ("Pipeline script from SCM", branch main) triggered by the GitLab
// push webhook, or a Multibranch Pipeline whose branch discovery is limited to main. Any other
// branch or merge request that reaches this file is skipped (isMain below).
//
// Agent requirements (label "help", or change the agent line):
//   - Linux, at least 4 cores and 8 GB RAM, about 20 GB free disk (pnpm store, images, browsers)
//   - Docker Engine with the compose plugin (2.24.4+) and buildx; the jenkins user in the docker
//     group. build-image.sh builds linux/amd64 and linux/arm64: the arm64 half needs QEMU/binfmt
//     (docker run --privileged --rm tonistiigi/binfmt --install arm64) and a buildx builder with
//     the docker-container driver (docker buildx create --use --name help). Without them set the
//     variable BUILD_PLATFORMS=linux/amd64 (the server's platform) on the job.
//   - Node 24 (package.json "engines") and pnpm through corepack (corepack enable; the version
//     comes from "packageManager" in package.json)
//   - git, bash, curl, ssh/scp (OpenSSH client), jq optional
//   - Playwright's Chromium system packages: ci.sh runs "playwright install --with-deps", which
//     needs root or passwordless sudo for apt (docs/runbooks/deploy.md)
//   - free ports 5432, 1025 and 8025 (PostgreSQL and Mailpit of docker-compose.dev.yml, started
//     by ci.sh). CI is left unset here, so ci.sh gives each run its own databases and a free e2e
//     port (isolate_local_run in scripts/lib.sh) and caps its workers to half the cores. On a
//     dedicated agent, CI=true uses every core but then needs port 3000 free and the fixed
//     spolu_e2e database.
//   - outbound HTTPS to the npm registry, Docker Hub (base images), the company registry, the
//     Playwright browser download, and SSH to $DEPLOY_HOST
//
// Plugins: Pipeline, Git, Credentials Binding, SSH Credentials, Lockable Resources, GitLab
// (webhook trigger; optional commit status), Timestamper.
//
// Job variables (not secret; set them as environment variables of the job or its folder, e.g.
// with the Folder Properties plugin, or under Manage Jenkins > System > Global properties):
//   DEPLOY_HOST       server host name or IP                                (required)
//   DEPLOY_PORT       SSH port                                              (default 22)
//   DOMAIN            public domain, e.g. help.egrant.sk                    (required)
//   IMAGE             image repository, lowercase, e.g. registry.example.com/egrant/spolu (required)
//   REGISTRY          registry host to log in to       (default: IMAGE up to its first "/")
//   BEHIND_PROXY      1 = behind the host's Apache (proxy mode)            (default empty = off)
//   HTTP_PORT         the local port Apache forwards to (required when BEHIND_PROXY=1)
//   REDIRECT_DOMAINS  old domains; in proxy mode Apache redirects them    (default empty)
//   MAIL_FROM_NAME    optional sender display name (scripts/lib.sh rename_senders)
//   BUILD_PLATFORMS   default linux/amd64,linux/arm64
// Credentials (Manage Jenkins > Credentials), never in this file:
//   help-prod-env          Secret file: the server's whole .env (deploy/prod.env.example)
//   help-prod-ssh          SSH Username with private key: user deploy on DEPLOY_HOST
//   help-prod-known-hosts  Secret text: the server's ssh-keyscan line(s), pins its host key
//   help-registry          Username with password: push and pull on the registry
//   help-gitlab-token      GitLab API token, optional: used by the GitLab plugin's connection
//                          (Manage Jenkins > System > GitLab) for the commit status below
// withCredentials writes the secret file and the key to private temporary files and deletes
// them when its block ends; masked values never show in the log.

def isMain() {
  // Multibranch sets BRANCH_NAME; a plain Pipeline job checks out main (GIT_BRANCH origin/main).
  return env.BRANCH_NAME ? env.BRANCH_NAME == 'main' : (env.GIT_BRANCH ?: 'main').replaceFirst('^origin/', '') == 'main'
}

pipeline {
  agent { label 'help' }

  options {
    disableConcurrentBuilds()
    // One ci.sh at a time on the shared agents (dev services, CPU), and deploys in push order.
    // Alternative without the Lockable Resources plugin: a dedicated agent with one executor.
    lock(resource: 'help-ci')
    timeout(time: 90, unit: 'MINUTES')
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '30'))
    // Optional: report the result on the commit in GitLab (GitLab plugin, connection "gitlab"
    // made with the help-gitlab-token credential). Uncomment together with the post steps below.
    // gitLabConnection('gitlab')
  }

  triggers {
    // GitLab push webhook (GitLab plugin). Multibranch jobs get the webhook through the branch
    // source instead; there, remove this block.
    gitlab(triggerOnPush: true, triggerOnMergeRequest: false, branchFilterType: 'NameBasedFilter', includeBranchesSpec: 'main')
  }

  stages {
    stage('Settings') {
      when { expression { isMain() } }
      steps {
        sh '''#!/usr/bin/env bash
          set -euo pipefail
          missing=()
          for v in DEPLOY_HOST DOMAIN IMAGE; do [[ -n "${!v:-}" ]] || missing+=("$v"); done
          if [[ "${BEHIND_PROXY:-}" == 1 && -z "${HTTP_PORT:-}" ]]; then missing+=(HTTP_PORT); fi
          if (( ${#missing[@]} )); then
            echo "Set these job variables first (see the header of the Jenkinsfile): ${missing[*]}" >&2
            exit 1
          fi
          echo "Deploying $IMAGE to $DEPLOY_HOST for https://$DOMAIN (BEHIND_PROXY=${BEHIND_PROXY:-})"
        '''
      }
    }

    stage('CI') {
      when { expression { isMain() } }
      options { timeout(time: 45, unit: 'MINUTES') }
      environment {
        // The docs check compares with the commit before the merge (it only warns).
        CI_BASE_REF = 'HEAD^'
      }
      steps {
        sh 'corepack enable 2>/dev/null || true'
        sh 'bash scripts/ci.sh'
      }
    }

    stage('Build image') {
      when { expression { isMain() } }
      options { timeout(time: 45, unit: 'MINUTES') }
      environment { EXTRA_TAG = 'prod' }
      steps {
        withCredentials([usernamePassword(credentialsId: 'help-registry',
            usernameVariable: 'REGISTRY_USER', passwordVariable: 'REGISTRY_PASSWORD')]) {
          // Single quotes: the shell expands the secrets, never Groovy (they stay out of the log).
          sh '''#!/usr/bin/env bash
            set -euo pipefail
            registry="${REGISTRY:-${IMAGE%%/*}}"
            printf '%s' "$REGISTRY_PASSWORD" | docker login "$registry" -u "$REGISTRY_USER" --password-stdin
            trap 'docker logout "$registry" >/dev/null' EXIT
            bash scripts/build-image.sh "$GIT_COMMIT"
          '''
        }
      }
    }

    stage('Deploy prod') {
      when { expression { isMain() } }
      options { timeout(time: 15, unit: 'MINUTES') }
      steps {
        withCredentials([
          file(credentialsId: 'help-prod-env', variable: 'DEPLOY_ENV_FILE'),
          sshUserPrivateKey(credentialsId: 'help-prod-ssh', keyFileVariable: 'DEPLOY_SSH_KEY',
            usernameVariable: 'DEPLOY_USER'),
          string(credentialsId: 'help-prod-known-hosts', variable: 'DEPLOY_KNOWN_HOSTS'),
          usernamePassword(credentialsId: 'help-registry',
            usernameVariable: 'REGISTRY_USER', passwordVariable: 'REGISTRY_PASSWORD'),
        ]) {
          // The server logs in to the registry with the same account to pull, then logs out.
          sh 'bash scripts/deploy.sh prod "$GIT_COMMIT"'
        }
      }
    }
  }

  post {
    failure {
      // Playwright's traces and page snapshots of failed e2e tests.
      archiveArtifacts artifacts: 'test-results/**', allowEmptyArchive: true, fingerprint: false
      // updateGitlabCommitStatus name: 'jenkins', state: 'failed'
    }
    // success { updateGitlabCommitStatus name: 'jenkins', state: 'success' }
  }
}
