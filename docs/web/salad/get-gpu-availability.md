---
title: Get GPU Availability
url: https://docs.salad.com/reference/saladcloud-api/organizations/get-gpu-availability
created_at: 2026-11-23T14:07:47-03:00
updated_at: 2026-11-23T14:07:47-03:00
tool: docs/web/tools/salad.md
license: CC-BY-4.0
---

# Get GPU Availability

> Gets the GPU availability for the given organization

*Last Updated: October 19, 2025*


## OpenAPI

````yaml api-specs/salad-cloud.yaml post /organizations/{organization_name}/availability/sce-gpu-availability
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
  /organizations/{organization_name}/availability/sce-gpu-availability:
    post:
      tags:
        - organizations
      summary: Get GPU Availability
      description: Gets the GPU availability for the given organization
      operationId: get_gpu_availability
      parameters:
        - $ref: '#/components/parameters/organization_name'
      requestBody:
        $ref: '#/components/requestBodies/GetGpuAvailability'
        description: Represents a request to check GPU availability
      responses:
        '200':
          $ref: '#/components/responses/GetGpuAvailability'
        '400':
          $ref: '#/components/responses/400'
        '401':
          $ref: '#/components/responses/401'
        '403':
          $ref: '#/components/responses/403'
        '404':
          $ref: '#/components/responses/404'
        '429':
          $ref: '#/components/responses/429'
        default:
          $ref: '#/components/responses/UnknownError'
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
  requestBodies:
    GetGpuAvailability:
      description: Represents a request to check GPU availability
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/GpuAvailabilityPrototype'
  responses:
    '400':
      description: Bad Request
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
    '401':
      description: Unauthorized
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
    '403':
      description: Forbidden
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
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
    GetGpuAvailability:
      description: Successfully retrieved GPU availability
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/GpuAvailability'
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
    GpuAvailabilityPrototype:
      type: object
      properties:
        country_codes:
          description: A list of country codes where the resources are available
          type: array
          items:
            $ref: '#/components/schemas/CountryCode'
          example:
            - us
            - ca
        cpu:
          description: The number of available CPU cores
          type: integer
          format: int32
          example: 4
          nullable: true
        gpu_classes:
          description: A list of available GPU class names
          type: array
          items:
            type: string
            format: uuid
          example:
            - 550e8400-e29b-41d4-a716-446655440000
            - 6ba7b810-9dad-11d1-80b4-00c04fd430c8
          minItems: 1
        memory:
          description: The amount of available memory in MB
          type: integer
          format: int64
          example: 8192
          nullable: true
        storage_amount:
          description: The amount of available storage in bytes
          type: integer
          format: int64
          example: 1000000000
          nullable: true
      required:
        - gpu_classes
    GpuAvailability:
      type: object
      properties:
        available_gpu_batch:
          description: The number of available GPU batches
          type: integer
          format: int32
          example: 2
        available_gpu_high:
          description: The number of available high-end GPUs
          type: integer
          format: int32
          example: 0
        available_gpu_low:
          description: The number of available low-end GPUs
          type: integer
          format: int32
          example: 1
        available_gpu_medium:
          description: The number of available medium-end GPUs
          type: integer
          format: int32
          example: 1
        on_call_gpu:
          description: The number of on-call GPUs available
          type: integer
          format: int32
          example: 1
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
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Salad-Api-Key

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
