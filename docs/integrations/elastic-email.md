# Elastic Email webhook (bulk email tracking)

For the owner: how to connect Elastic Email's webhook so the bulk email report shows delivered, opened, clicked, bounced and spam complaints. Design: [ADR 0070](../decisions/0070-elastic-webhook-tracking.md); product behaviour: [bulk email](../product/bulk-email.md#opens-clicks-and-bounces-adr-0070).

Needs Elastic's **PRO** plan (webhooks are a PRO feature) and `BULK_EMAIL_DRIVER=elastic`.

## Create the webhook

In Elastic: **Settings → Manage webhooks → Create webhook** (or `POST /v4/webhook`):

| setting | value |
|---|---|
| URL | `https://help.egrant.sk/api/bulk-email/webhook` (exactly this: signed webhooks do not follow redirects, so not `spolu.egrant.sk`) |
| Delivery and security | **POST (JSON body)** (`DeliveryMethod: PostJson`) and **Sign requests** ticked (`EnableSigning: true`). Both can be chosen only when the webhook is created. |
| Events | Sent, Opened, Clicked, Unsubscribed, Abuse report (complaints), Error (bounces) |
| Notify once per email | off (`NotifyOncePerEmail: false`); Help stores each event once anyway |

Saving sends a test event. Help does not know the new secret yet and answers 401, which Elastic accepts for a newly created signed webhook.

The **Webhook created.** window shows the signing secret **once**. Put it in the server env as `ELASTIC_WEBHOOK_SECRET` (never in a chat, ticket or screenshot) and deploy. From then on Help sends bulk email with open and click tracking on and accepts the webhook's events. Without the variable the route is a 404 and nothing is tracked.

## Check

Send a campaign to yourself, open it and click a link. Within a minute the report shows a card **Opens and clicks** with Delivered 1, Opened 1, Clicked 1, and your row shows Opened and Clicked. If not: the server log has `bulk email webhook` lines (never the event's content); a 401 means the secret differs; Elastic retries rejected events for 24 hours.

## Rotating the secret

**Rotate secret** on the webhook in Elastic shows a new secret once, used within about a minute; update `ELASTIC_WEBHOOK_SECRET` and deploy straight away. Events rejected meanwhile are retried.

## What is stored

Per event: campaign, person, kind, Elastic's date and, for a bounce, Elastic's category. Never the address, IP, device or clicked link. A complaint, an unsubscribe or a permanent bounce (`NoMailbox`) unsubscribes the person from bulk email (only bulk email; login codes and notifications still arrive).
