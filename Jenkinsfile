// Jenkins pipeline for Help by eGrant (code name Spolu) on the company's Jenkins (ADR 0074,
// docs/runbooks/deploy.md "Jenkins"). It only calls scripts/deploy.sh: all logic lives in
// scripts/ (ADR 0004).
//
// It works like the company's eGrant LIVE job: SSH to the server with the jenkins user's own key,
// nothing else. No checks run here: scripts/ci.sh runs before every merge to main (the merge
// gate). No registry: BUILD_ON_SERVER=1 makes deploy.sh pipe "git archive <commit>" over SSH into
// "docker build" on the server, then start that image in $DEPLOY_ROOT/prod and wait for
// /api/health to report the commit. A failed build or start leaves the previous version running.
//
// What Jenkins needs (and nothing more: no Docker, Node, credentials or plugins beyond Pipeline
// and Git):
//   - git, bash and an OpenSSH client on the node (any node: agent any)
//   - the jenkins user's default SSH key (~jenkins/.ssh/id_*) in the authorized_keys of
//     $DEPLOY_USER on $DEPLOY_HOST. The server's host key is pinned by deploy/known_hosts in this
//     repository; the jenkins user's own known_hosts is never used or changed.
//   - a Pipeline job, "Pipeline script from SCM", branch main, a full clone (rollback to an older
//     commit needs it in the history)
// Secrets never live in Jenkins: the owner puts the whole .env on the server once, by hand
// ($DEPLOY_ROOT/prod/.env, mode 600, from deploy/prod.env.example) and edits it there; each
// deploy reads it, applies DOMAIN, PUBLIC_URL and the proxy settings below, and writes it back.
//
// Rollback: "Build with Parameters", DEPLOY_COMMIT=<an older commit of main>. Its image is reused
// while still on the server (images unused for 7 days are pruned), otherwise it is rebuilt.
//
// DOMAIN is help.egrant.sk since the evening of the cut-over (docs/runbooks/server-move.md).
// Once DNS points here, remove HEALTH_CHECK_LOCAL below (the public
// https://$DOMAIN/api/health is then checked through Apache) and add the GitLab push trigger:
//   triggers { gitlab(triggerOnPush: true, triggerOnMergeRequest: false,
//     branchFilterType: 'NameBasedFilter', includeBranchesSpec: 'main') }
// (GitLab plugin; or "Build when a change is pushed to GitLab" in the job's settings). Until then
// the job is started by hand only.

def isMain() {
  // Multibranch sets BRANCH_NAME; a plain Pipeline job checks out main (GIT_BRANCH origin/main).
  return env.BRANCH_NAME ? env.BRANCH_NAME == 'main' : (env.GIT_BRANCH ?: 'main').replaceFirst('^origin/', '') == 'main'
}

pipeline {
  agent any

  options {
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30'))
  }

  parameters {
    string(name: 'DEPLOY_COMMIT', defaultValue: '',
      description: 'Empty: deploy the checked-out main. A commit of main: deploy that one instead (rollback).')
  }

  // Not secret. The server's .env holds the secrets (see above).
  environment {
    DEPLOY_HOST = 'knb.ui42.sk'
    DEPLOY_USER = 'caddy'
    DEPLOY_PORT = '22'
    DEPLOY_ROOT = '/home/caddy/help'
    DOMAIN = 'help.egrant.sk'
    IMAGE = 'spolu'
    BEHIND_PROXY = '1'
    HTTP_PORT = '9003'
    // The server's firewall lets only this subnet of Docker networks out (SMTP, HTTPS, DNS).
    DOCKER_SUBNET = '172.30.42.0/24'
    BUILD_ON_SERVER = '1'
    HEALTH_CHECK_LOCAL = '1'
  }

  stages {
    stage('Deploy prod') {
      when { expression { isMain() } }
      steps {
        sh '''#!/usr/bin/env bash
          set -euo pipefail
          commit="$(git rev-parse --verify "${DEPLOY_COMMIT:-$GIT_COMMIT}^{commit}")"
          DEPLOY_KNOWN_HOSTS="$(cat deploy/known_hosts)" bash scripts/deploy.sh prod "$commit"
        '''
      }
    }
  }
}
