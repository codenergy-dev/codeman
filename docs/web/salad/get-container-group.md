---
title: Get Container Group
url: https://docs.salad.com/reference/saladcloud-api/container-groups/get-container-group
created_at: 2026-10-29T11:06:09-03:00
updated_at: 2026-10-29T11:06:09-03:00
tool: docs/web/tools/salad.md
license: CC-BY-4.0
---

# Get Container Group

> Gets a container group

*Last Updated: July 1, 2025*


## OpenAPI

````yaml api-specs/salad-cloud.yaml get /organizations/{organization_name}/projects/{project_name}/containers/{container_group_name}
openapi: 3.1.0
info:
  title: SaladCloud API
  description: >-
    The SaladCloud REST API. Please refer to the [SaladCloud API
    Documentation](https://docs.salad.com/api-reference) for more details.
  termsOfService: https://salad.com/terms
  contact:
    name: SaladCloud Support
    url: https://salad.com
    email: cloud@salad.com
  license:
    name: MIT License
    identifier: MIT
  version: 0.9.0-alpha.17
servers:
  - url: https://api.salad.com/api/public
security:
  - ApiKeyAuth: []
tags:
  - name: container_groups
    description: Container Groups
  - name: inference_endpoints
    description: Inference Endpoints
  - name: organization_data
    description: Auxiliary organization data and info
  - name: queues
    description: Job Queues
  - name: quotas
    description: quotas
  - name: system_logs
    description: System Logs
  - name: webhook_secret_key
    description: Webhook Secret Key
  - name: logs
    description: Platform and Application Log Entries
  - name: Availability
    description: Sce Node Availability
paths:
  /organizations/{organization_name}/projects/{project_name}/containers/{container_group_name}:
    summary: Container Group
    description: Operations for a container group
    parameters:
      - $ref: '#/components/parameters/organization_name'
      - $ref: '#/components/parameters/project_name'
      - $ref: '#/components/parameters/container_group_name'
    get:
      tags:
        - container_groups
      summary: Get Container Group
      description: Gets a container group
      operationId: get_container_group
      responses:
        '200':
          $ref: '#/components/responses/GetContainerGroup'
        '404':
          $ref: '#/components/responses/404'
        '429':
          $ref: '#/components/responses/429'
        default:
          $ref: '#/components/responses/UnknownError'
      x-codeSamples:
        - source: >-
            using Salad.Cloud.SDK;

            using Salad.Cloud.SDK.Config;


            var config = new SaladCloudSdkConfig{};


            var client = new SaladCloudSdkClient(config);


            var response = await
            client.ContainerGroups.GetContainerGroupAsync("acme-corp",
            "dev-env", "mandlebrot");


            Console.WriteLine(response);
          lang: C#
        - source: |-
            import com.salad.cloud.sdk.SaladCloudSdk;
            import com.salad.cloud.sdk.config.ApiKeyAuthConfig;
            import com.salad.cloud.sdk.config.SaladCloudSdkConfig;
            import com.salad.cloud.sdk.models.ContainerGroup;

            public class Main {

              public static void main(String[] args) {
                SaladCloudSdkConfig config = SaladCloudSdkConfig.builder()
                  .apiKeyAuthConfig(ApiKeyAuthConfig.builder().apiKey("YOUR_API_KEY").build())
                  .build();

                SaladCloudSdk saladCloudSdk = new SaladCloudSdk(config);

                ContainerGroup response = saladCloudSdk.containerGroups.getContainerGroup("acme-corp", "dev-env", "mandlebrot");

                System.out.println(response);
              }
            }
          lang: Java
        - source: >-
            import (
              "fmt"
              "encoding/json"
              "context"
              "github.com/saladtechnologies/salad-cloud-sdk-go/pkg/saladcloudsdkconfig"
              "github.com/saladtechnologies/salad-cloud-sdk-go/pkg/saladcloudsdk"

            )


            config := saladcloudsdkconfig.NewConfig()

            config.SetApiKey("API_KEY")

            client := saladcloudsdk.NewSaladCloudSdk(config)


            response, err :=
            client.ContainerGroups.GetContainerGroup(context.Background(),
            "acme-corp", "dev-env", "mandlebrot")

            if err != nil {
              panic(err)
            }


            fmt.Println(response)
          lang: Go
        - source: >-
            import { SaladCloudSdk } from
            '@saladtechnologies-oss/salad-cloud-sdk';


            (async () => {
              const saladCloudSdk = new SaladCloudSdk({
                apiKey: 'YOUR_API_KEY',
              });

              const { data } = await saladCloudSdk.containerGroups.getContainerGroup('acme-corp', 'dev-env', 'mandlebrot');

              console.log(data);
            })();
          lang: TypeScript
        - source: |-
            from salad_cloud_sdk import SaladCloudSdk

            sdk = SaladCloudSdk(
                api_key="YOUR_API_KEY",
                api_key_header="YOUR_API_KEY_HEADER",
                timeout=10000
            )

            result = sdk.container_groups.get_container_group(
                organization_name="acme-corp",
                project_name="dev-env",
                container_group_name="mandlebrot"
            )

            print(result)
          lang: Python
components:
  parameters:
    organization_name:
      name: organization_name
      in: path
      description: >-
        Your organization name. This identifies the billing context for the API
        operation and represents a security boundary for SaladCloud resources.
        The organization must be created before using the API, and you must be a
        member of the organization.
      required: true
      schema:
        $ref: '#/components/schemas/OrganizationName'
    project_name:
      name: project_name
      in: path
      description: >-
        Your project name. This represents a collection of related SaladCloud
        resources. The project must be created before using the API.
      required: true
      schema:
        $ref: '#/components/schemas/ProjectName'
    container_group_name:
      in: path
      name: container_group_name
      description: The unique container group name
      required: true
      schema:
        $ref: '#/components/schemas/ContainerGroupName'
  responses:
    '404':
      description: Not Found
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
    '429':
      description: Too Many Requests
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
    GetContainerGroup:
      description: OK
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ContainerGroup'
    UnknownError:
      description: Unknown Error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
  schemas:
    OrganizationName:
      description: The organization name.
      type: string
      examples:
        - acme-corp
      maxLength: 63
      minLength: 2
      pattern: ^[a-z][a-z0-9-]{0,61}[a-z0-9]$
      title: Organization Name
    ProjectName:
      description: The project name.
      type: string
      examples:
        - dev-env
      maxLength: 63
      minLength: 2
      pattern: ^[a-z][a-z0-9-]{0,61}[a-z0-9]$
    ContainerGroupName:
      description: The container group name.
      type: string
      examples:
        - mandlebrot
      maxLength: 63
      minLength: 2
      pattern: ^[a-z][a-z0-9-]{0,61}[a-z0-9]$
      title: Container Group Name
    ContainerGroup:
      description: >-
        A container group definition that represents a scalable set of identical
        containers running as a distributed service
      type: object
      properties:
        autostart_policy:
          description: >-
            Defines whether containers in this group should automatically start
            when deployed (true) or require manual starting (false)
          type: boolean
        container:
          $ref: '#/components/schemas/Container'
        country_codes:
          description: >-
            List of country codes where container instances are permitted to
            run. When not specified or empty, containers may run in any
            available region.
          type: array
          items:
            $ref: '#/components/schemas/CountryCode'
          maxItems: 500
          minItems: 0
        create_time:
          description: ISO 8601 timestamp when this container group was initially created
          type: string
          format: date-time
        current_state:
          $ref: '#/components/schemas/ContainerGroupState'
        display_name:
          $ref: '#/components/schemas/DisplayName'
        id:
          $ref: '#/components/schemas/ContainerGroupId'
        liveness_probe:
          $ref: '#/components/schemas/ContainerGroupLivenessProbe'
        name:
          $ref: '#/components/schemas/ContainerGroupName'
        networking:
          $ref: '#/components/schemas/ContainerGroupNetworking'
        organization_name:
          $ref: '#/components/schemas/OrganizationName'
        pending_change:
          description: >-
            Indicates whether a configuration change has been requested but not
            yet applied to all containers in the group
          type: boolean
        priority:
          $ref: '#/components/schemas/ContainerGroupPriority'
        project_name:
          $ref: '#/components/schemas/ProjectName'
        queue_autoscaler:
          $ref: '#/components/schemas/ContainerGroupQueueAutoscaler'
        queue_connection:
          $ref: '#/components/schemas/ContainerGroupQueueConnection'
        readiness_probe:
          $ref: '#/components/schemas/ContainerGroupReadinessProbe'
        readme:
          type: string
          maxLength: 65000
          minLength: 2
        replicas:
          $ref: '#/components/schemas/ContainerGroupReplicas'
        restart_policy:
          $ref: '#/components/schemas/ContainerRestartPolicy'
        scaling-actions:
          description: List of scaling actions configurations
          type: array
          items:
            $ref: '#/components/schemas/ContainerGroupScalingAction'
          maxItems: 100
          minItems: 0
        scheduled-scaling-enabled:
          description: Indicates if scheduled scaling is enabled
          type: boolean
        startup_probe:
          $ref: '#/components/schemas/ContainerGroupStartupProbe'
        update_time:
          description: ISO 8601 timestamp when this container group was last updated
          type: string
          format: date-time
        version:
          description: >-
            Incremental version number that increases with each configuration
            change to the container group
          type: integer
          format: int32
          maximum: 2147483647
          minimum: 1
      required:
        - autostart_policy
        - container
        - country_codes
        - create_time
        - current_state
        - display_name
        - id
        - name
        - organization_name
        - pending_change
        - priority
        - project_name
        - replicas
        - restart_policy
        - update_time
        - version
        - scheduled-scaling-enabled
        - scaling-actions
      title: Container Group
    ProblemDetails:
      description: Represents an API error
      type: object
      properties:
        detail:
          description: >-
            The human-readable explanation specific to this occurrence of the
            error.
          type: string
          examples:
            - The container group could not be found.
          maxLength: 2000
          minLength: 1
        instance:
          description: >-
            The URI reference that identifies the specific occurrence of the
            error.
          type: string
          format: url
          examples:
            - https://example.com/error-instances/12345
          maxLength: 2048
          minLength: 1
        status:
          description: >-
            The HTTP status code generated by the origin server for this
            occurrence of the error.
          type: integer
          format: int32
          examples:
            - 404
          maximum: 599
          minimum: 100
        title:
          description: The short, human-readable summary of the error type.
          type: string
          examples:
            - Not Found
          maxLength: 2000
          minLength: 1
        type:
          description: The URI reference that identifies the error type.
          type: string
          format: url
          default: about:blank
          examples:
            - https://example.com/errors/invalid-request
          maxLength: 2048
          minLength: 1
    Container:
      description: Represents a container with its configuration and resource requirements.
      type: object
      properties:
        command:
          description: >-
            List of commands to run inside the container. Each command is a
            string representing a command-line instruction.
          type:
            - 'null'
            - array
          items:
            type: string
            pattern: ^.*$
            minLength: 1
            maxLength: 2048
          maxItems: 100
          minItems: 0
        environment_variables:
          description: Environment variables to set in the container.
          type: object
          additionalProperties:
            type: string
            description: Key-value pairs of environment variables to set in the container.
            pattern: ^.*$
            minLength: 0
            maxLength: 2048
        hash:
          description: SHA-256 hash (64-character hexadecimal string)
          type: string
          maxLength: 135
          minLength: 47
          pattern: ^sha\d{1,3}:[a-fA-F0-9]{40,135}$
        image:
          $ref: '#/components/schemas/ContainerImage'
        image_caching:
          $ref: '#/components/schemas/ContainerImageCaching'
        logging:
          $ref: '#/components/schemas/ContainerLogging'
        resources:
          $ref: '#/components/schemas/ContainerResourceRequirements'
        size:
          description: Size of the container in bytes.
          type: integer
          format: int64
          maximum: 9223372036854776000
          minimum: 0
      required:
        - command
        - image
        - resources
    CountryCode:
      description: ISO 3166-1 alpha-2 country code
      type: string
      example: us
      enum:
        - af
        - al
        - dz
        - as
        - ad
        - ao
        - ai
        - aq
        - ag
        - ar
        - am
        - aw
        - au
        - at
        - az
        - bs
        - bh
        - bd
        - bb
        - by
        - be
        - bz
        - bj
        - bm
        - bt
        - bo
        - bq
        - ba
        - bw
        - bv
        - br
        - io
        - bn
        - bg
        - bf
        - bi
        - cv
        - kh
        - cm
        - ca
        - ky
        - cf
        - td
        - cl
        - cn
        - cx
        - cc
        - co
        - km
        - cd
        - cg
        - ck
        - cr
        - hr
        - cu
        - cw
        - cy
        - cz
        - ci
        - dk
        - dj
        - dm
        - do
        - ec
        - eg
        - sv
        - gq
        - er
        - ee
        - sz
        - et
        - fk
        - fo
        - fj
        - fi
        - fr
        - gf
        - pf
        - tf
        - ga
        - gm
        - ge
        - de
        - gh
        - gi
        - gr
        - gl
        - gd
        - gp
        - gu
        - gt
        - gg
        - gn
        - gw
        - gy
        - ht
        - hm
        - va
        - hn
        - hk
        - hu
        - is
        - in
        - id
        - ir
        - iq
        - ie
        - im
        - il
        - it
        - jm
        - jp
        - je
        - jo
        - kz
        - ke
        - ki
        - kp
        - kr
        - kw
        - kg
        - la
        - lv
        - lb
        - ls
        - lr
        - ly
        - li
        - lt
        - lu
        - mo
        - mg
        - mw
        - my
        - mv
        - ml
        - mt
        - mh
        - mq
        - mr
        - mu
        - yt
        - mx
        - fm
        - md
        - mc
        - mn
        - me
        - ms
        - ma
        - mz
        - mm
        - na
        - nr
        - np
        - nl
        - nc
        - nz
        - ni
        - ne
        - ng
        - nu
        - nf
        - mp
        - 'no'
        - om
        - pk
        - pw
        - ps
        - pa
        - pg
        - py
        - pe
        - ph
        - pn
        - pl
        - pt
        - pr
        - qa
        - mk
        - ro
        - ru
        - rw
        - re
        - bl
        - sh
        - kn
        - lc
        - mf
        - pm
        - vc
        - ws
        - sm
        - st
        - sa
        - sn
        - rs
        - sc
        - sl
        - sg
        - sx
        - sk
        - si
        - sb
        - so
        - za
        - gs
        - ss
        - es
        - lk
        - sd
        - sr
        - sj
        - se
        - ch
        - sy
        - tw
        - tj
        - tz
        - th
        - tl
        - tg
        - tk
        - to
        - tt
        - tn
        - tr
        - tm
        - tc
        - tv
        - ug
        - ua
        - ae
        - gb
        - um
        - us
        - uy
        - uz
        - vu
        - ve
        - vn
        - vg
        - vi
        - wf
        - eh
        - ye
        - zm
        - zw
        - ax
      title: Country Code
    ContainerGroupState:
      description: >-
        Represents the operational state of a container group during its
        lifecycle, including timing information, status, and instance
        distribution metrics. This state captures the current execution status,
        start and finish times, and provides visibility into the operational
        health across instances.
      type: object
      properties:
        description:
          description: >-
            Optional textual description or notes about the current state of the
            container group
          type:
            - string
            - 'null'
          maxLength: 1000
          minLength: 0
          pattern: ^.*$
        finish_time:
          description: >-
            Timestamp when the container group execution finished or is expected
            to finish
          type: string
          format: date-time
        instance_status_counts:
          $ref: '#/components/schemas/ContainerGroupInstanceStatusCount'
        start_time:
          description: Timestamp when the container group execution started
          type: string
          format: date-time
        status:
          $ref: '#/components/schemas/ContainerGroupStatus'
      required:
        - finish_time
        - instance_status_counts
        - start_time
        - status
      title: Container Group State
    DisplayName:
      description: The display-friendly name of the resource.
      type: string
      examples:
        - Name
      maxLength: 63
      minLength: 2
      pattern: ^[ ,-.0-9A-Za-z]+$
    ContainerGroupId:
      description: The container group identifier.
      type: string
      format: uuid
      examples:
        - ab3a4591-efc3-46c0-b06a-3d820c0ec100
      title: Container Group ID
    ContainerGroupLivenessProbe:
      description: >-
        Defines a liveness probe for container groups that determines when to
        restart a container if it becomes unhealthy
      type:
        - object
        - 'null'
      properties:
        exec:
          $ref: '#/components/schemas/ContainerGroupProbeExec'
        failure_threshold:
          description: >-
            Number of consecutive failures required to consider the probe as
            failed
          type: integer
          format: int32
          default: 3
          maximum: 20
          minimum: 1
        grpc:
          $ref: '#/components/schemas/ContainerGroupProbeGrpc'
        http:
          $ref: '#/components/schemas/ContainerGroupProbeHttp'
        initial_delay_seconds:
          description: >-
            Number of seconds to wait after container start before initiating
            liveness probes
          type: integer
          format: int32
          default: 0
          maximum: 1200
          minimum: 0
        period_seconds:
          description: Frequency in seconds at which the probe should be executed
          type: integer
          format: int32
          default: 10
          maximum: 120
          minimum: 1
        success_threshold:
          description: >-
            Number of consecutive successes required to consider the probe
            successful
          type: integer
          format: int32
          default: 1
          maximum: 10
          minimum: 1
        tcp:
          $ref: '#/components/schemas/ContainerGroupProbeTcp'
        timeout_seconds:
          description: >-
            Number of seconds after which the probe times out if no response is
            received
          type: integer
          format: int32
          default: 30
          maximum: 60
          minimum: 1
      required:
        - failure_threshold
        - initial_delay_seconds
        - period_seconds
        - success_threshold
        - timeout_seconds
    ContainerGroupNetworking:
      description: >-
        Network configuration for container groups that defines connectivity,
        routing, and access control settings
      type: object
      properties:
        auth:
          description: >-
            Whether authentication is required for network access to the
            container group
          type: boolean
        client_request_timeout:
          $ref: '#/components/schemas/ContainerGroupNetworkingClientRequestTimeout'
        dns:
          description: >-
            Domain name or URL endpoint for the container group's network
            interface
          type: string
          format: url
          maxLength: 253
          minLength: 1
          pattern: ^([a-z][a-z0-9-]{0,61}[a-z0-9]\.)*[a-z][a-z0-9-]{0,61}[a-z0-9]$
        load_balancer:
          $ref: '#/components/schemas/ContainerGroupNetworkingLoadBalancer'
        port:
          $ref: '#/components/schemas/ContainerGroupNetworkingPort'
        protocol:
          $ref: '#/components/schemas/ContainerNetworkingProtocol'
        server_response_timeout:
          $ref: '#/components/schemas/ContainerGroupNetworkingServerResponseTimeout'
        single_connection_limit:
          $ref: '#/components/schemas/ContainerGroupNetworkingSingleConnectionLimit'
      required:
        - auth
        - dns
        - load_balancer
        - port
        - protocol
      title: Container Group Networking Configuration
    ContainerGroupPriority:
      description: >-
        Specifies the priority level for container group execution, which
        determines resource allocation and scheduling precedence.
      type:
        - string
        - 'null'
      enum:
        - high
        - medium
        - low
        - batch
      title: Container Group Priority
    ContainerGroupQueueAutoscaler:
      description: >-
        Defines configuration for automatically scaling container instances
        based on queue length. The autoscaler monitors a queue and adjusts the
        number of running replicas to maintain the desired queue length.
      type: object
      properties:
        desired_queue_length:
          description: >-
            The target number of items in the queue that the autoscaler attempts
            to maintain by scaling the containers up or down
          type: integer
          format: int32
          maximum: 100
          minimum: 1
        max_downscale_per_minute:
          description: >-
            The maximum number of instances that can be removed per minute to
            prevent rapid downscaling
          type: integer
          format: int32
          maximum: 100
          minimum: 1
        max_replicas:
          description: The maximum number of instances the container can scale up to
          type: integer
          format: int32
          maximum: 500
          minimum: 1
        max_upscale_per_minute:
          description: >-
            The maximum number of instances that can be added per minute to
            prevent rapid upscaling
          type: integer
          format: int32
          maximum: 100
          minimum: 1
        min_replicas:
          description: >-
            The minimum number of instances the container can scale down to,
            ensuring baseline availability
          type: integer
          format: int32
          maximum: 100
          minimum: 0
        polling_period:
          description: >-
            The period (in seconds) in which the autoscaler checks the queue
            length and applies the scaling formula
          type: integer
          format: int32
          maximum: 1800
          minimum: 15
      required:
        - desired_queue_length
        - max_replicas
        - min_replicas
      title: Queue-based Autoscaler Configuration
    ContainerGroupQueueConnection:
      description: >-
        Configuration for connecting a container group to a message queue
        system, enabling asynchronous communication between services.
      type: object
      properties:
        path:
          description: >-
            The endpoint path for accessing the queue service, relative to the
            base URL of the queue server.
          type: string
          maxLength: 1024
          minLength: 1
          pattern: ^.*$
        port:
          description: >-
            The network port number used to connect to the queue service. Must
            be a valid TCP/IP port between 1 and 65535.
          type: integer
          format: int32
          maximum: 65535
          minimum: 1
        queue_name:
          description: >-
            Unique identifier for the queue. Must start with a lowercase letter,
            can contain lowercase letters, numbers, and hyphens, and must end
            with a letter or number.
          type: string
          maxLength: 63
          minLength: 2
          pattern: ^[a-z][a-z0-9-]{0,61}[a-z0-9]$
      required:
        - path
        - port
        - queue_name
    ContainerGroupReadinessProbe:
      description: >-
        Defines how to check if a container is ready to serve traffic. The
        readiness probe determines whether the container's application is ready
        to accept traffic. If the readiness probe fails, the container is
        considered not ready and traffic will not be sent to it.
      type:
        - object
        - 'null'
      properties:
        exec:
          $ref: '#/components/schemas/ContainerGroupProbeExec'
        failure_threshold:
          description: >-
            The number of consecutive failures required to consider the probe
            failed. After this many consecutive failures, the container is
            marked as not ready.
          type: integer
          format: int32
          default: 3
          maximum: 20
          minimum: 1
        grpc:
          $ref: '#/components/schemas/ContainerGroupProbeGrpc'
        http:
          $ref: '#/components/schemas/ContainerGroupProbeHttp'
        initial_delay_seconds:
          description: >-
            The time in seconds to wait after the container starts before
            initiating the first probe. This allows time for the application to
            initialize before being tested.
          type: integer
          format: int32
          default: 0
          maximum: 1200
          minimum: 0
        period_seconds:
          description: >-
            How frequently (in seconds) the probe should be executed during the
            container's lifetime. Specifies the interval between consecutive
            probe executions.
          type: integer
          format: int32
          default: 1
          maximum: 120
          minimum: 1
        success_threshold:
          description: >-
            The minimum consecutive successes required to consider the probe
            successful after it has failed. Defines how many successful probe
            results are needed to transition from failure to success.
          type: integer
          format: int32
          default: 1
          maximum: 10
          minimum: 1
        tcp:
          $ref: '#/components/schemas/ContainerGroupProbeTcp'
        timeout_seconds:
          description: >-
            The maximum time in seconds that the probe has to complete. If the
            probe doesn't return a result before the timeout, it's considered
            failed.
          type: integer
          format: int32
          default: 1
          maximum: 60
          minimum: 1
      required:
        - failure_threshold
        - initial_delay_seconds
        - period_seconds
        - success_threshold
        - timeout_seconds
    ContainerGroupReplicas:
      description: The container group replicas.
      type: integer
      format: int32
      examples:
        - 50
      maximum: 500
      minimum: 0
      title: Container Group Replicas
    ContainerRestartPolicy:
      description: Specifies the policy for restarting containers when they exit or fail.
      type: string
      enum:
        - always
        - on_failure
        - never
      title: Container Restart Policy
    ContainerGroupScalingAction:
      description: Represents a scaling action configuration for a container group
      type: object
      properties:
        replicas:
          description: The number of replicas to scale to during the scheduled period
          type: integer
          format: int32
          maximum: 500
          minimum: 0
        schedule:
          description: >-
            The cron-style schedule string defining when the scaling should
            occur
          type: string
          pattern: ^([0-9A-Za-z*/,-]+)([\t ]+[0-9A-Za-z*/,-]+){4}$
      required:
        - schedule
        - replicas
      title: Container Group Scaling Action
    ContainerGroupStartupProbe:
      description: >-
        Defines a probe that checks if a container application has started
        successfully. Startup probes help prevent applications from being
        prematurely marked as unhealthy during initialization. The probe can use
        HTTP requests, TCP connections, gRPC calls, or shell commands to
        determine startup status.
      type:
        - object
        - 'null'
      properties:
        exec:
          $ref: '#/components/schemas/ContainerGroupProbeExec'
        failure_threshold:
          description: >-
            Number of times the probe must fail before considering the container
            not started
          type: integer
          format: int32
          default: 15
          maximum: 20
          minimum: 1
        grpc:
          $ref: '#/components/schemas/ContainerGroupProbeGrpc'
        http:
          $ref: '#/components/schemas/ContainerGroupProbeHttp'
        initial_delay_seconds:
          description: >-
            Number of seconds to wait after container startup before the first
            probe is executed
          type: integer
          format: int32
          default: 0
          maximum: 1200
          minimum: 0
        period_seconds:
          description: How frequently (in seconds) to perform the probe
          type: integer
          format: int32
          default: 3
          maximum: 120
          minimum: 1
        success_threshold:
          description: >-
            Minimum consecutive successes required for the probe to be
            considered successful
          type: integer
          format: int32
          default: 2
          maximum: 10
          minimum: 1
        tcp:
          $ref: '#/components/schemas/ContainerGroupProbeTcp'
        timeout_seconds:
          description: >-
            Maximum time (in seconds) to wait for a probe response before
            considering it failed
          type: integer
          format: int32
          default: 10
          maximum: 60
          minimum: 1
      required:
        - failure_threshold
        - initial_delay_seconds
        - period_seconds
        - success_threshold
        - timeout_seconds
      title: Container Group Startup Probe
    ContainerImage:
      description: The container image.
      type: string
      examples:
        - acme/:latest
      maxLength: 2048
      minLength: 1
      pattern: ^.*$
      title: Container Image
    ContainerImageCaching:
      description: The container image caching.
      type: boolean
      examples:
        - true
      title: Container Image Caching
    ContainerLogging:
      description: >-
        Configuration options for directing container logs to a logging
        provider. This schema enables you to specify a single logging
        destination for container output, supporting monitoring, debugging, and
        analytics use cases. Each provider has its own configuration parameters
        defined in the referenced schemas. Only one logging provider can be
        selected at a time.
      type: object
      properties:
        axiom:
          $ref: '#/components/schemas/ContainerLoggingAxiom'
        datadog:
          $ref: '#/components/schemas/ContainerLoggingDatadog'
        http:
          $ref: '#/components/schemas/ContainerLoggingHttp'
        new_relic:
          $ref: '#/components/schemas/ContainerLoggingNewRelic'
        splunk:
          $ref: '#/components/schemas/ContainerLoggingSplunk'
        tcp:
          $ref: '#/components/schemas/ContainerLoggingTcp'
      title: Container Logging Configuration
    ContainerResourceRequirements:
      description: Specifies the resource requirements for a container.
      type: object
      properties:
        cpu:
          description: >-
            The number of CPU cores required by the container. Must be between 1
            and 16.
          type: integer
          format: int32
          maximum: 1024
          minimum: 1
        gpu_classes:
          description: >-
            A list of GPU class UUIDs required by the container. Can be null if
            no GPU is required.
          type: array
          items:
            type: string
            format: uuid
          maxItems: 100
          minItems: 0
        memory:
          description: >-
            The amount of memory (in MB) required by the container. Must be
            between 1024 MB and 61440 MB.
          type: integer
          format: int32
          maximum: 1073741824
          minimum: 1024
        shm_size:
          description: >-
            The size of the shared memory (/dev/shm) in MB. If not specified,
            defaults to 1024MB.
          type: integer
          format: int32
          default: 64
          maximum: 1073741824
          minimum: 64
        storage_amount:
          description: >-
            The amount of storage (in bytes) required by the container. Must be
            between 1 GB (1073741824 bytes) and 250 GB (268435456000 bytes).
          type: integer
          format: int64
          maximum: 1125899906842624
          minimum: 1073741824
      required:
        - cpu
        - memory
        - gpu_classes
    ContainerGroupInstanceStatusCount:
      description: >-
        A summary of container group instances categorized by their current
        lifecycle status
      type: object
      properties:
        allocating_count:
          description: >-
            The number of container instances that are currently being allocated
            resources
          type: integer
          format: int32
          maximum: 2147483647
          minimum: 0
        creating_count:
          description: >-
            The number of container instances that are in the process of being
            created
          type: integer
          format: int32
          maximum: 2147483647
          minimum: 0
        running_count:
          description: >-
            The number of container instances that are currently running and
            operational
          type: integer
          format: int32
          maximum: 2147483647
          minimum: 0
        stopping_count:
          description: >-
            The number of container instances that are in the process of
            stopping
          type: integer
          format: int32
          maximum: 2147483647
          minimum: 0
      required:
        - allocating_count
        - creating_count
        - running_count
        - stopping_count
    ContainerGroupStatus:
      description: >-
        Represents the current operational state of a container group within the
        Salad platform.
      type: string
      enum:
        - pending
        - running
        - stopped
        - succeeded
        - failed
        - deploying
      title: ContainerGroupStatus
    ContainerGroupProbeExec:
      description: >-
        Defines the exec action for a probe in a container group. This is used
        to execute a command inside a container for health checks.
      type: object
      properties:
        command:
          description: >-
            The command to execute inside the container. Exit status of 0 is
            considered successful, any other exit status is considered failure.
          type: array
          items:
            type: string
            description: Individual component of the command to be run.
            pattern: ^.*$
            minLength: 1
            maxLength: 2048
          maxItems: 100
          minItems: 1
      required:
        - command
      title: Container Group Probe Exec
    ContainerGroupProbeGrpc:
      description: >-
        Configuration for gRPC-based health probes in container groups, used to
        determine container health status.
      type: object
      properties:
        port:
          description: The port number on which the gRPC health check service is exposed.
          type: integer
          format: int32
          maximum: 65536
          minimum: 0
        service:
          description: >-
            The name of the gRPC service that implements the health check
            protocol.
          type: string
          maxLength: 1024
          minLength: 0
          pattern: ^.*$
      required:
        - port
        - service
      title: Container Group gRPC Probe
    ContainerGroupProbeHttp:
      description: >-
        Defines HTTP probe configuration for container health checks within a
        container group.
      type: object
      properties:
        headers:
          $ref: '#/components/schemas/ContainerGroupProbeHttpHeaders'
        path:
          description: The HTTP path that will be probed to check container health.
          type: string
          maxLength: 2048
          minLength: 1
          pattern: ^.*$
        port:
          description: The TCP port number to which the HTTP request will be sent.
          type: integer
          format: int32
          maximum: 65536
          minimum: 0
        scheme:
          $ref: '#/components/schemas/ContainerProbeHttpScheme'
      required:
        - headers
        - path
        - port
        - scheme
      title: Container Group HTTP Probe Configuration
    ContainerGroupProbeTcp:
      description: >-
        Configuration for a TCP probe used to check container health via network
        connectivity.
      type: object
      properties:
        port:
          description: >-
            The TCP port number that the probe should connect to. Must be a
            valid port number between 0 and 65535.
          type: integer
          format: int32
          maximum: 65535
          minimum: 0
      required:
        - port
      title: Container Group TCP Probe
    ContainerGroupNetworkingClientRequestTimeout:
      description: The container group networking client request timeout.
      type: integer
      format: int32
      default: 100000
      examples:
        - 100000
      maximum: 100000
      minimum: 1
      title: Container Group Networking Client Request Timeout
    ContainerGroupNetworkingLoadBalancer:
      description: The container group networking load balancer.
      type: string
      default: round_robin
      enum:
        - round_robin
        - least_number_of_connections
      title: The Container Group Networking Load Balancer
    ContainerGroupNetworkingPort:
      description: The container group networking port.
      type: integer
      format: int32
      examples:
        - 60000
      maximum: 65535
      minimum: 1
      title: Container Group Networking Port
    ContainerNetworkingProtocol:
      description: >-
        Defines the communication protocol used for network traffic between
        containers or external systems. Currently supports HTTP protocol for
        web-based communication.
      type: string
      enum:
        - http
      title: Container Networking Protocol
    ContainerGroupNetworkingServerResponseTimeout:
      description: The container group networking server response timeout.
      type: integer
      format: int32
      default: 100000
      examples:
        - 100000
      maximum: 100000
      minimum: 1
      title: Container Group Networking Server Response Timeout
    ContainerGroupNetworkingSingleConnectionLimit:
      description: The container group networking single connection limit flag.
      type: boolean
      default: false
      examples:
        - false
      title: Container Group Networking Single Connection Limit
    ContainerLoggingAxiom:
      description: >-
        Configuration settings for integrating container logs with the Axiom
        logging service. When specified, container logs will be forwarded to the
        Axiom instance defined by these parameters.
      type: object
      properties:
        api_token:
          description: >-
            Authentication token for the Axiom API with appropriate write
            permissions
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        dataset:
          description: >-
            Name of the Axiom dataset where the container logs will be stored
            and indexed
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        host:
          description: The Axiom host URL where logs will be sent (e.g. logs.axiom.co)
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
      required:
        - host
        - api_token
        - dataset
      title: Axiom Logging Configuration
    ContainerLoggingDatadog:
      description: >-
        Configuration for forwarding container logs to Datadog monitoring
        service.
      type: object
      properties:
        api_key:
          description: The Datadog API key used for authentication when sending logs.
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        host:
          description: The Datadog intake server host URL where logs will be sent.
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        tags:
          description: >-
            Optional metadata tags to attach to logs for filtering and
            categorization in Datadog.
          items:
            $ref: '#/components/schemas/ContainerLoggingDatadogTag'
          maxItems: 1000
          minItems: 0
          type:
            - array
            - 'null'
      required:
        - host
        - api_key
        - tags
      title: Datadog Logging Configuration
    ContainerLoggingHttp:
      description: >-
        Configuration for sending container logs to an HTTP endpoint. Defines
        how logs are formatted, compressed, and transmitted.
      type: object
      properties:
        compression:
          $ref: '#/components/schemas/ContainerLoggingHttpCompression'
        format:
          $ref: '#/components/schemas/ContainerLoggingHttpFormat'
        headers:
          description: Optional HTTP headers to include in log transmission requests
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ContainerLoggingHttpHeader'
          maxItems: 1000
          minItems: 0
        host:
          description: The hostname or IP address of the HTTP logging endpoint
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        password:
          description: Optional password for HTTP authentication
          type:
            - string
            - 'null'
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        path:
          description: Optional URL path for the HTTP endpoint
          type:
            - string
            - 'null'
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        port:
          description: The port number of the HTTP logging endpoint (1-65535)
          type: integer
          format: int32
          maximum: 65535
          minimum: 1
        user:
          description: Optional username for HTTP authentication
          type:
            - string
            - 'null'
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
      required:
        - headers
        - host
        - port
        - format
        - compression
      title: Container HTTP Logging Configuration
    ContainerLoggingNewRelic:
      description: >-
        Configuration for sending container logs to New Relic's log management
        platform.
      type: object
      properties:
        host:
          description: >-
            The New Relic endpoint host for log ingestion (e.g.,
            log-api.newrelic.com).
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        ingestion_key:
          description: >-
            The New Relic license or ingestion key used for authentication and
            data routing.
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
      required:
        - host
        - ingestion_key
      title: New Relic Logging Configuration
    ContainerLoggingSplunk:
      description: >-
        Configuration settings for forwarding container logs to a Splunk
        instance.
      type: object
      properties:
        host:
          description: The URL of the Splunk HTTP Event Collector (HEC) endpoint.
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        token:
          description: >-
            The authentication token required to send data to the Splunk HEC
            endpoint.
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
      required:
        - host
        - token
      title: Container Logging Splunk Configuration
    ContainerLoggingTcp:
      description: Configuration for forwarding container logs to a remote TCP endpoint
      type: object
      properties:
        host:
          description: The hostname or IP address of the remote TCP logging endpoint
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        port:
          description: The port number on which the TCP logging endpoint is listening
          type: integer
          format: int32
          maximum: 65535
          minimum: 1
      required:
        - host
        - port
      title: TCP Logging Configuration
    ContainerGroupProbeHttpHeaders:
      description: >-
        A collection of HTTP header name-value pairs used for configuring
        requests and responses in container group endpoints. Each header
        consists of a name and its corresponding value.
      type: array
      items:
        $ref: '#/components/schemas/ContainerGroupProbeHttpHeader'
      maxItems: 50
      minItems: 1
      title: HTTP Headers
    ContainerProbeHttpScheme:
      description: >-
        The protocol scheme used for HTTP probe requests in container health
        checks.
      type:
        - string
        - 'null'
      enum:
        - http
        - https
      title: HTTP Scheme
    ContainerLoggingDatadogTag:
      description: Represents a Datadog tag used for container logging metadata.
      type: object
      properties:
        name:
          description: The name of the metadata tag.
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        value:
          description: The value of the metadata tag.
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
      required:
        - name
        - value
      title: Datadog Tag for Container Logging
    ContainerLoggingHttpCompression:
      description: The compression algorithm to apply to logs before transmission
      type: string
      enum:
        - none
        - gzip
    ContainerLoggingHttpFormat:
      description: The format in which logs will be delivered
      type: string
      enum:
        - json
        - json_lines
    ContainerLoggingHttpHeader:
      description: Represents an HTTP header used for container logging configuration.
      type: object
      properties:
        name:
          description: The name of the HTTP header
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
        value:
          description: The value of the HTTP header
          type: string
          maxLength: 1000
          minLength: 1
          pattern: ^.*$
      required:
        - name
        - value
      title: Container Logging Http Header
    ContainerGroupProbeHttpHeader:
      type: object
      properties:
        name:
          description: The name of the HTTP header
          type: string
          maxLength: 256
          minLength: 1
          pattern: ^.*$
        value:
          description: The value associated with the HTTP header
          type: string
          maxLength: 1024
          minLength: 1
          pattern: ^.*$
      required:
        - name
        - value
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Salad-Api-Key

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
