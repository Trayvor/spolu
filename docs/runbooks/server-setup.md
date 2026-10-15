# Server setup

How to prepare a fresh Ubuntu or Oracle Linux VM to run Spolu. Done once per server.

## 1. Create the deploy key

On your laptop, a key used only by CI to log in as `deploy`:

```bash
ssh-keygen -t ed25519 -N '' -C spolu-test-deploy -f ~/.ssh/spolu_test
```

The private key `~/.ssh/spolu_test` becomes the `TEST_SSH_KEY` secret (see [deploy.md](deploy.md)); the public key goes to the server below.

## 2. Run server-setup.sh as root

```bash
scp scripts/server-setup.sh scripts/lib.sh ~/.ssh/spolu_test.pub <admin-user>@<host>:/tmp/
ssh <admin-user>@<host> 'sudo bash /tmp/server-setup.sh /tmp/spolu_test.pub'
```

The argument is the public key line itself or the path to a `.pub` file on the server. The script is idempotent: run it again any time (for example to add a second key). It:

1. installs Docker Engine and the compose plugin from Docker's repository (Ubuntu: apt; Oracle Linux: dnf with Docker's RHEL repo) and writes `/etc/docker/daemon.json` with log rotation (10 MB x 3) if that file does not exist yet;
2. opens 80/tcp, 443/tcp and 443/udp in the host firewall and keeps them after reboot:
   - Oracle Linux: `firewalld` (`http`, `https`, `443/udp`, permanent);
   - Ubuntu with `ufw` active: `ufw allow`;
   - Ubuntu without `ufw` (Oracle Cloud images): iptables `ACCEPT` rules inserted before the `REJECT` that ends `INPUT`, live and in `/etc/iptables/rules.v4` (loaded by netfilter-persistent at boot). The file is edited directly instead of `netfilter-persistent save`, which would also save Docker's own rules;
3. creates the `deploy` user in the `docker` group and adds the key to its `authorized_keys`;
4. creates `/opt/spolu` owned by `deploy` (each environment lives in `/opt/spolu/<env>/`);
5. turns on automatic security updates (Ubuntu `unattended-upgrades`; Oracle Linux `dnf-automatic` with `upgrade_type = security`);
6. adds a 2 GB `/swapfile` if the server has no swap.

## 3. Outside the server

- Open 80/tcp, 443/tcp and 443/udp in the cloud network firewall too (Oracle Cloud: the subnet's security list or the instance's network security group). The script cannot do this.
- Point the DNS record of the environment's domain at the server. Caddy gets the TLS certificate on the first start.
- Record the server's host key for CI: `ssh-keyscan <host>` → the `DEPLOY_KNOWN_HOSTS` variable (see [deploy.md](deploy.md)).

Then deploy as in [deploy.md](deploy.md).
