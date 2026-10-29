---
title: Get Container Group Instance
url: https://docs.salad.com/reference/saladcloud-api/container-groups/get-container-group-instance
created_at: 2026-10-29T11:06:09-03:00
updated_at: 2026-10-29T11:06:09-03:00
tool: docs/web/tools/salad.md
license: CC-BY-4.0
---

# Get Container Group Instance

> Gets a container group instance

*Last Updated: July 1, 2025*


## OpenAPI

````yaml api-specs/salad-cloud.yaml get /organizations/{organization_name}/projects/{project_name}/containers/{container_group_name}/instances/{container_group_instance_id}
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
  /organizations/{organization_name}/projects/{project_name}/containers/{container_group_name}/instances/{container_group_instance_id}:
    summary: Container Group Instance
    description: Operations for a container group instance
    parameters:
      - $ref: '#/components/parameters/organization_name'
      - $ref: '#/components/parameters/project_name'
      - $ref: '#/components/parameters/container_group_name'
      - $ref: '#/components/parameters/container_group_instance_id'
    get:
      tags:
        - container_groups
      summary: Get Container Group Instance
      description: Gets a container group instance
      operationId: get_container_group_instance
      responses:
        '202':
          $ref: '#/components/responses/GetContainerGroupInstance'
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
            client.ContainerGroups.GetContainerGroupInstanceAsync("acme-corp",
            "dev-env", "mandlebrot", "db3a4591-efc3-46c0-b06a-3d820c0ec100");


            Console.WriteLine(response);
          lang: C#
        - source: |-
            import com.salad.cloud.sdk.SaladCloudSdk;
            import com.salad.cloud.sdk.config.ApiKeyAuthConfig;
            import com.salad.cloud.sdk.config.SaladCloudSdkConfig;
            import com.salad.cloud.sdk.models.ContainerGroupInstance;

            public class Main {

              public static void main(String[] args) {
                SaladCloudSdkConfig config = SaladCloudSdkConfig.builder()
                  .apiKeyAuthConfig(ApiKeyAuthConfig.builder().apiKey("YOUR_API_KEY").build())
                  .build();

                SaladCloudSdk saladCloudSdk = new SaladCloudSdk(config);

                ContainerGroupInstance response = saladCloudSdk.containerGroups.getContainerGroupInstance(
                  "acme-corp",
                  "dev-env",
                  "mandlebrot",
                  "db3a4591-efc3-46c0-b06a-3d820c0ec100"
                );

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
            client.ContainerGroups.GetContainerGroupInstance(context.Background(),
            "acme-corp", "dev-env", "mandlebrot",
            "db3a4591-efc3-46c0-b06a-3d820c0ec100")

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

              const { data } = await saladCloudSdk.containerGroups.getContainerGroupInstance(
                'acme-corp',
                'dev-env',
                'mandlebrot',
                'db3a4591-efc3-46c0-b06a-3d820c0ec100',
              );

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

            result = sdk.container_groups.get_container_group_instance(
                organization_name="acme-corp",
                project_name="dev-env",
                container_group_name="mandlebrot",
                container_group_instance_id="db3a4591-efc3-46c0-b06a-3d820c0ec100"
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
    container_group_instance_id:
      in: path
      name: container_group_instance_id
      description: The unique container group instance identifier
      required: true
      schema:
        $ref: '#/components/schemas/ContainerGroupInstanceId'
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
    GetContainerGroupInstance:
      description: OK
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ContainerGroupInstance'
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
    ContainerGroupInstanceId:
      description: The container group instance identifier.
      type: string
      format: uuid
      examples:
        - db3a4591-efc3-46c0-b06a-3d820c0ec100
      title: Container Group Instance ID
    ContainerGroupInstance:
      description: >-
        A Container Group Instance represents a running instance of a container
        group on a specific machine. It provides information about the execution
        state, readiness, and version of the deployed container group.
      type: object
      properties:
        cpu_percent:
          description: >-
            The percentage of CPU used by this container group instance. This is
            updated every minute.
          type: number
          format: float
          minimum: 0
        cpu_usage:
          description: >-
            The total CPU usage in seconds for this container group instance.
            This is updated every minute.
          type: integer
          format: int64
          minimum: 0
        cpu_usage_total:
          description: >-
            The total CPU usage in seconds for this container group instance
            since it was started. This is updated every minute.
          type: integer
          format: int64
          minimum: 0
        deletion_cost:
          description: The cost of deleting the container group instance
          type: integer
          default: 0
          maximum: 100000
          minimum: 0
        id:
          $ref: '#/components/schemas/ContainerGroupInstanceId'
        machine_id:
          $ref: '#/components/schemas/ContainerGroupMachineId'
        memory_usage_mb:
          description: >-
            The memory usage in MB for this container group instance. This is
            updated every minute.
          type: number
          format: float
          minimum: 0
        memory_usage_percent:
          description: >-
            The percentage of memory used by this container group instance. This
            is updated every minute.
          type: number
          format: float
          minimum: 0
        pulling_progress:
          description: >-
            The progress percentage of pulling the container image. This is only
            relevant when the instance state is 'downloading'.
          type: number
          format: float
          maximum: 100
          minimum: 0
        ready:
          description: >-
            Indicates whether the container group instance is currently passing
            its readiness checks and is able to receive traffic or perform its
            intended function. If no readiness probe is defined, this will be
            true once the instance is fully started.
          type: boolean
        ssh_host_key_fingerprint:
          $ref: '#/components/schemas/ContainerGroupInstanceSshHostKeyFingerprint'
        ssh_ip:
          $ref: '#/components/schemas/ContainerGroupInstanceSshIp'
        ssh_port:
          $ref: '#/components/schemas/ContainerGroupInstanceSshPort'
        started:
          description: >-
            Indicates whether the container group instance has successfully
            completed its startup sequence and passed any configured startup
            probes. This will always be true when no startup probe is defined
            for the container group.
          type: boolean
        state:
          $ref: '#/components/schemas/ContainerGroupInstanceState'
        update_time:
          description: >-
            The UTC timestamp when the container group instance last changed its
            state. This helps track the lifecycle and state transitions of the
            instance.
          type: string
          format: date-time
        version:
          description: >-
            The version of the container group definition currently running on
            this instance. Used to track deployment and update progress across
            the container group fleet.
          type: integer
          format: int32
          maximum: 2147483647
          minimum: 1
      required:
        - id
        - machine_id
        - state
        - update_time
        - version
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
    ContainerGroupMachineId:
      description: The container group machine identifier.
      type: string
      format: uuid
      examples:
        - eb3a4591-efc3-46c0-b06a-3d820c0ec100
      title: Container Group Machine ID
    ContainerGroupInstanceSshHostKeyFingerprint:
      description: The SSH host key fingerprint of the container group instance
      type: string
      example: SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8
      maxLength: 256
      minLength: 1
    ContainerGroupInstanceSshIp:
      description: The SSH IP address of the container group instance
      type: string
      format: ipv4
      example: 192.168.1.100
    ContainerGroupInstanceSshPort:
      description: The SSH port of the container group instance
      type: integer
      format: int32
      default: 22
      maximum: 65535
      minimum: 1
    ContainerGroupInstanceState:
      description: The state of the container group instance
      type: string
      enum:
        - allocating
        - downloading
        - creating
        - running
        - stopping
      title: The Container Group Instance State
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Salad-Api-Key

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
