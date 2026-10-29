---
title: Instance Metadata Service (IMDS) Overview
url: https://docs.salad.com/container-engine/explanation/infrastructure-platform/imds
created_at: 2026-10-29T11:06:09-03:00
updated_at: 2026-10-29T11:06:09-03:00
tool: docs/web/tools/salad.md
license: CC-BY-4.0
---

# Instance Metadata Service (IMDS) Overview

*Last Updated: October 15, 2024*

The SaladCloud Instance Metadata Service (IMDS) provides your container instances with data and operations that you can
use to configure and manage your applications.

IMDS is a REST API available at the non-routable IPv4 address `169.254.169.254` on port `80`. IMDS is only accessible
from within a running container instance on SaladCloud, and the requests never leave the SaladCloud Node. HTTP clients
in your container instances must bypass any web proxies when calling IMDS.

## Access IMDS

To access IMDS, create a Container Group through the SaladCloud API or the SaladCloud Portal, open a terminal to a
running container instance through the SaladCloud Portal, and use the following sample.

The `/v1/status` endpoint can be used to get the health statuses of the running container instance. Call the endpoint
from the terminal using `curl`:

```sh theme={null}
curl -s -H "Metadata: true" --noproxy "*" http://169.254.169.254/v1/status
```

> [!NOTE]
>
> You can \[learn more]\[1] about this command and its arguments on the awesome [https://explainshell.com](https://explainshell.com) website.

This returns the health statuses of the running container instance as a JSON string. This example response is
pretty-printed for readability.

```json theme={null}
{
  "ready": true,
  "started": true
}
```

Other endpoints are provided to get an identity token for the running container instance and to reallocate the container
instance to another SaladCloud Node. Refer to the [IMDS API Reference](https://docs.salad.com/reference/imds/) for more details.

## IMDS SDKs

We provide SDKs to facilitate IMDS integrations from your applications. We strongly encourage the use of the IMDS SDKs
over custom HTTP client integrations whenever possible. Refer to the package READMEs for more details on installation
and configuration.

> **[Python](https://pypi.org/project/salad-cloud-sdk/)**
>
> PyPI

> **[JavaScript (TypeScript)](https://www.npmjs.com/package/@saladtechnologies-oss/salad-cloud-imds-sdk)**
>
> npm

> **[Java (Kotlin)](https://central.sonatype.com/artifact/com.salad.cloud/imds-sdk)**
>
> Maven Central Repository

> **[Go](https://github.com/SaladTechnologies/salad-cloud-imds-sdk-go)**
>
> GitHub

> **[.NET](https://www.nuget.org/packages/Salad.Cloud.IMDS.SDK)**
>
> NuGet

The following samples demonstrate using the SDKs to get the health statuses of the running container instance.

```python Python theme={null}
from salad_cloud_imds_sdk import SaladCloudImdsSdk

client = SaladCloudImdsSdk()

response = client.metadata.get_container_status() print(f'Started: {response.started}') print(f'Ready: {response.ready}')
```

```javascript JavaScript theme={null}
import { SaladCloudImdsSdk } from '@saladtechnologies-oss/salad-cloud-imds-sdk'

const client = new SaladCloudImdsSdk({})

const { data } = await client.metadata.getContainerStatus()
console.log(`Started: ${data.started}`)
console.log(`Ready: ${data.ready}`)
```

```java Java theme={null}
import com.salad.cloud.imdssdk.SaladCloudImdsSdk;
import com.salad.cloud.imdssdk.models.ContainerStatus;

SaladCloudImdsSdk client = new SaladCloudImdsSdk();

ContainerStatus response = saladCloudImdsSdk.metadataService.getContainerStatus();
System.out.println("Started: " + response.started.toString());
System.out.println("Ready: " + response.ready.toString());
```

```go Go theme={null}
import (
  "context"
  "fmt"

  "github.com/saladtechnologies/salad-cloud-imds-sdk-go/pkg/saladcloudimdssdk"
  "github.com/saladtechnologies/salad-cloud-imds-sdk-go/pkg/saladcloudimdssdkconfig"
)

config := saladcloudimdssdkconfig.NewConfig()
client := saladcloudimdssdk.NewSaladCloudImdsSdk(config)

resp, err := client.Metadata.GetContainerStatus(context.Background())
if err == nil {
  fmt.Printf("Started: %t", resp.Data.Started)
  fmt.Printf("Ready: %t", resp.Data.Ready)
}
```

```csharp C# theme={null}
using Salad.Cloud.IMDS.SDK;

var client = new SaladCloudImdsSdkClient();

var response = await client.Metadata.GetContainerStatusAsync();
Console.WriteLine($"Started: {response.Started}");
Console.WriteLine($"Ready: {response.Ready}");
```

## Security and Authentication

IMDS is only accessible from within a running container instance on SaladCloud, and the requests never leave the Salad
Node. IMDS requests sent to web proxies will fail, and you should explicitly configure your HTTP client to disable any
web proxies (manually configured or automatically discovered).

To prevent unintended or unwanted redirection of requests, requests to IMDS must contain the custom header
`Metadata: true` and must not contain any `X-Forwarded-For`, `X-Forwarded-Host`, or `X-Forwarded-Proto` headers. Any
requests missing the custom header `Metadata: true` or containing the `X-Forwarded-For`, `X-Forwarded-Host`, or
`X-Forwarded-Proto` headers are rejected with a `403 Forbidden` response.

[1]: https://explainshell.com/explain?cmd=curl+-s+-H+%22Metadata%3A+true%22+--noproxy+%22*%22+http%3A%2F%2F169.254.169.254%2Fv1%2Fstatus


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
