---
title: Authenticated Requests
url: https://docs.salad.com/container-engine/how-to-guides/gateway/sending-requests
created_at: 2026-10-29T11:06:09-03:00
updated_at: 2026-10-29T11:06:09-03:00
tool: docs/web/tools/salad.md
license: CC-BY-4.0
---

# Authenticated Requests

*Last Updated: October 15, 2024*

If you have selected authentication for the Container Gateway, the access domain name will indicated it is "Protected"
and a lock icon will be shown. You will need to provide your API key in the header of requests.

First, you'll need the domain name of your container group and your API key. You can view and copy your API key at
[portal](https://portal.salad.com/api-key).

Obtain the domain name in the details of your deployment, e.g.

![](https://mintcdn.com/salad/pEBrSzH4UQRtJw00/container-engine/images/portal-access-domain-name.png?fit=max\&auto=format\&n=pEBrSzH4UQRtJw00\&q=85\&s=d158f3a5bd0dde1aa361cba1575364bc)

You can Copy the domain name by clicking the copy icon on the right.

Send a request to the access domain name with your API key included in the header as `Salad-Api-Key` however you'd like,
e.g.

```
curl --location '[YOUR ACCESS DOMAIN NAME HERE]'
  --header 'Content-Type: application/json'
    --header 'Salad-Api-Key: [YOUR API KEY HERE]'
      --data '{
 								...
              }'
```

# Optional Container Gateway Authentication

Please note that requiring authenticated networking to the containers is optional, You can choose whether to enable or
disable authentication for your containers. However, we recommend implementing your own authentication if you plan not
to use ours.

![](https://mintcdn.com/salad/ko38nW-LNf6N2Y1I/container-engine/images/portal-enable-authentication.png?fit=max\&auto=format\&n=ko38nW-LNf6N2Y1I\&q=85\&s=9ef70617ece084810431ebe61228d4cb)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
