# Bulk email brief (owner, 2026-10-16)

Translated from the owner's Ukrainian messages. A module for bulk emails, like Mailchimp ("hromadné e-maily"): an email builder, targeted sending to people chosen from the system, and a count of how many opened the email. Planned as the phase after Phases 21 and 22; it needs a spec and a plan before code.

## Owner decisions (2026-10-16)

- Builder: blocks. The blocks are heading, text, image, button, divider and the eGrant logo; a block can be reordered. A live preview shows the email on desktop and on a phone. No free drag-and-drop layout.
- Recipients: only people in Spolu. Filters by client group, by role (client, ziadatel, admin), by a manager's groups, or by individual people. No import of outside contacts.
- Tracking: use what Elastic Email reports through its webhook (delivered, opened, clicked, bounced, unsubscribed, complaints). Build no tracker of our own unless Elastic cannot provide something.
- Sender subdomain: `news.egrant.sk`. Its reputation is kept apart from the login-code emails.
- Who sends: every admin.

## Known constraints

- Every bulk email needs an unsubscribe link and a `List-Unsubscribe` header. People who unsubscribed are left out of later sends.
- Open counts are approximate: Apple Mail opens every message, and some clients block images. The report should say so.
- The domain `news.egrant.sk` must be verified in Elastic Email (SPF, DKIM, DMARC and the tracking CNAME at the DNS host) before the first real send.
