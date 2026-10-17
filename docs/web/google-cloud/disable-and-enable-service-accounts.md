---
title: Disable and enable service accounts
url: https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable
created_at: 2026-10-17T13:07:14-03:00
updated_at: 2026-10-17T13:07:14-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Disable and enable service accounts

This page explains how to disable and enable service accounts using the
Identity and Access Management (IAM) API, the Google Cloud console, and the
gcloud CLI.

## Before you begin

-


  Enable the IAM API, if it is not already enabled.


  **Roles required to enable APIs**


  To enable APIs, you need the `serviceusage.services.enable` permission. If you
  created the project, then you likely already have this permission through the
  Owner role (`roles/owner`). Otherwise, you can get this permission through the
  Service Usage Admin role (`roles/serviceusage.serviceUsageAdmin`).
  [Learn how to grant roles](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access).

  [Enable the API](https://console.cloud.google.com/apis/enableflow?apiid=iam.googleapis.com&redirect=https://console.cloud.google.com)

  <br />

- Set up authentication.


  Select the tab for how you plan to use the samples on this page:

  ### Console


  When you use the Google Cloud console to access Google Cloud services and
  APIs, you don't need to set up authentication.

  ### gcloud

  In the Google Cloud console, activate Cloud Shell.

  [Activate Cloud Shell](https://console.cloud.google.com/?cloudshell=true)


  At the bottom of the Google Cloud console, a
  [Cloud Shell](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works)
  session starts and displays a command-line prompt. Cloud Shell is a shell environment
  with the Google Cloud CLI
  already installed and with values already set for
  your current project. It can take a few seconds for the session to initialize.

  ### C#


  To use the .NET samples on this page in a local development environment, install and
  initialize the gcloud CLI, and then set up Application Default Credentials with
  your user credentials.
  1.
     [Install](https://docs.cloud.google.com/sdk/docs/install) the Google Cloud CLI.

  2. If you're using an external identity provider (IdP), you must first
     [sign in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).

  3.

     If you're using a local shell, then create local authentication credentials for your user
     account:

     ```bash
     gcloud auth application-default login
     ```

     You don't need to do this if you're using Cloud Shell.


     If an authentication error is returned, and you are using an external identity provider
     (IdP), confirm that you have
     [signed in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).


  For more information, see
  [Set up ADC for a local development environment](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
  in the Google Cloud authentication documentation.

  ### C++


  To use the C++ samples on this page in a local development environment, install and
  initialize the gcloud CLI, and then set up Application Default Credentials with
  your user credentials.
  1.
     [Install](https://docs.cloud.google.com/sdk/docs/install) the Google Cloud CLI.

  2. If you're using an external identity provider (IdP), you must first
     [sign in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).

  3.

     If you're using a local shell, then create local authentication credentials for your user
     account:

     ```bash
     gcloud auth application-default login
     ```

     You don't need to do this if you're using Cloud Shell.


     If an authentication error is returned, and you are using an external identity provider
     (IdP), confirm that you have
     [signed in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).


  For more information, see
  [Set up ADC for a local development environment](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
  in the Google Cloud authentication documentation.

  ### Go


  To use the Go samples on this page in a local development environment, install and
  initialize the gcloud CLI, and then set up Application Default Credentials with
  your user credentials.
  1.
     [Install](https://docs.cloud.google.com/sdk/docs/install) the Google Cloud CLI.

  2. If you're using an external identity provider (IdP), you must first
     [sign in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).

  3.

     If you're using a local shell, then create local authentication credentials for your user
     account:

     ```bash
     gcloud auth application-default login
     ```

     You don't need to do this if you're using Cloud Shell.


     If an authentication error is returned, and you are using an external identity provider
     (IdP), confirm that you have
     [signed in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).


  For more information, see
  [Set up ADC for a local development environment](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
  in the Google Cloud authentication documentation.

  ### Java


  To use the Java samples on this page in a local development environment, install and
  initialize the gcloud CLI, and then set up Application Default Credentials with
  your user credentials.
  1.
     [Install](https://docs.cloud.google.com/sdk/docs/install) the Google Cloud CLI.

  2. If you're using an external identity provider (IdP), you must first
     [sign in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).

  3.

     If you're using a local shell, then create local authentication credentials for your user
     account:

     ```bash
     gcloud auth application-default login
     ```

     You don't need to do this if you're using Cloud Shell.


     If an authentication error is returned, and you are using an external identity provider
     (IdP), confirm that you have
     [signed in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).


  For more information, see
  [Set up ADC for a local development environment](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
  in the Google Cloud authentication documentation.

  ### Python


  To use the Python samples on this page in a local development environment, install and
  initialize the gcloud CLI, and then set up Application Default Credentials with
  your user credentials.
  1.
     [Install](https://docs.cloud.google.com/sdk/docs/install) the Google Cloud CLI.

  2. If you're using an external identity provider (IdP), you must first
     [sign in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).

  3.

     If you're using a local shell, then create local authentication credentials for your user
     account:

     ```bash
     gcloud auth application-default login
     ```

     You don't need to do this if you're using Cloud Shell.


     If an authentication error is returned, and you are using an external identity provider
     (IdP), confirm that you have
     [signed in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).


  For more information, see
  [Set up ADC for a local development environment](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
  in the Google Cloud authentication documentation.

  ### REST


  To use the REST API samples on this page in a local development environment, you use the
  credentials you provide to the gcloud CLI.
  1. [Install](https://docs.cloud.google.com/sdk/docs/install) the Google Cloud CLI.
  2. If you're using an external identity provider (IdP), you must first [sign in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).


  For more information, see
  [Authenticate for using REST](https://docs.cloud.google.com/docs/authentication/rest)
  in the Google Cloud authentication documentation.

  <br />

- Understand [IAM service accounts](https://docs.cloud.google.com/iam/docs/service-account-overview)

### Required roles


To get the permissions that
you need to manage service accounts,

ask your administrator to grant you the
[Service Account Admin](https://docs.cloud.google.com/iam/docs/roles-permissions/iam#iam.serviceAccountAdmin) (`roles/iam.serviceAccountAdmin`) IAM role on the project.


For more information about granting roles, see [Manage access to projects, folders, and organizations](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access).


You might also be able to get
the required permissions through [custom
roles](https://docs.cloud.google.com/iam/docs/creating-custom-roles) or other [predefined
roles](https://docs.cloud.google.com/iam/docs/roles-overview#predefined).

IAM basic roles also contain permissions to manage service
accounts.
You should not grant basic roles in a production environment, but you can grant them in a
development or test environment.

## Disable a service account

Similar to deleting a service account, when you disable a service account,
applications will no longer have access to Google Cloud resources
through that service account. If you disable the default App Engine and
Compute Engine service accounts, the instances will no longer have
access to resources in the project. If you attempt to disable an already
disabled service account, it will have no effect.

Unlike deleting a service account, disabled service accounts can easily be
re-enabled as necessary. We recommend disabling a service account before
deleting it to make sure no critical applications are using the service account.
For more information, see [Disable unused service
accounts before deleting them](https://docs.cloud.google.com/iam/docs/best-practices-service-accounts#disable-before-delete).

### Console

1. In the Google Cloud console, go to the **Service accounts** page.

   [Go to Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Select a project.

3. Click the name of the service account that you want to disable.

4. Under **Service account status** , click **Disable service account** , then
   click **Disable** to confirm the change.

### gcloud

1. In the Google Cloud console, activate Cloud Shell.

   [Activate Cloud Shell](https://console.cloud.google.com/?cloudshell=true)


   At the bottom of the Google Cloud console, a
   [Cloud Shell](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works)
   session starts and displays a command-line prompt. Cloud Shell is a shell environment
   with the Google Cloud CLI
   already installed and with values already set for
   your current project. It can take a few seconds for the session to initialize.
2. Execute the `https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/disable` command to disable a service account.

   Command:

   ```
   gcloud iam service-accounts disable SA_NAME@PROJECT_ID.iam.gserviceaccount.com
   ```

   Output:

   ```
   Disabled service account SA_NAME@PROJECT_ID.iam.gserviceaccount.com
   ```

### C++


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM C++ API
reference documentation](https://docs.cloud.google.com/cpp/docs/reference/iam/latest).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    namespace iam = ::google::cloud::iam_admin_v1;
    [](std::string const& name) {
      iam::IAMClient client(iam::MakeIAMConnection());
      google::iam::admin::v1::DisableServiceAccountRequest request;
      request.set_name(name);
      auto response = client.DisableServiceAccount(request);
      if (!response.ok()) throw std::runtime_error(response.message());
      std::cout << "ServiceAccount successfully disabled.\n";
    }

### C#


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM C# API
reference documentation](https://developers.google.com/api-client-library/dotnet/apis/iam/v1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).


    using System;
    using https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.html;
    using Google.Apis.Iam.v1;
    using Google.Apis.Iam.v1.Data;

    public partial class ServiceAccounts
    {
        public static void DisableServiceAccount(string email)
        {
            var credential = https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.GoogleCredential.html.https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.GoogleCredential.html#Google_Apis_Auth_OAuth2_GoogleCredential_GetApplicationDefault()
                .https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.GoogleCredential.html#Google_Apis_Auth_OAuth2_GoogleCredential_CreateScoped_System_Collections_Generic_IEnumerable_System_String__(IamService.Scope.CloudPlatform);
            var service = new IamService(new IamService.Initializer
            {
                HttpClientInitializer = credential
            });

            var request = new DisableServiceAccountRequest();

            string resource = "projects/-/serviceAccounts/" + email;
            service.Projects.ServiceAccounts.Disable(request, resource).Execute();
            Console.WriteLine("Disabled service account: " + email);
        }
    }

### Go


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM Go API
reference documentation](https://pkg.go.dev/cloud.google.com/go/iam/admin/apiv1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    import (
    	"context"
    	"fmt"
    	"io"

    	iam "google.golang.org/api/iam/v1"
    )

    // disableServiceAccount disables a service account.
    func disableServiceAccount(w io.Writer, email string) error {
    	// email:= service-account@your-project.iam.gserviceaccount.com
    	ctx := context.Background()
    	service, err := iam.NewService(ctx)
    	if err != nil {
    		return fmt.Errorf("iam.NewService: %w", err)
    	}

    	request := &iam.DisableServiceAccountRequest{}
    	_, err = service.Projects.ServiceAccounts.Disable("projects/-/serviceAccounts/"+email, request).Do()
    	if err != nil {
    		return fmt.Errorf("Projects.ServiceAccounts.Disable: %w", err)
    	}
    	fmt.Fprintf(w, "Disabled service account: %v", email)
    	return nil
    }

### Java


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM Java API
reference documentation](https://developers.google.com/api-client-library/java/apis/iam/v1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    import com.google.cloud.iam.admin.v1.https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.cloud.iam.admin.v1.IAMClient.html;
    import com.google.iam.admin.v1.https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.iam.admin.v1.DisableServiceAccountRequest.html;
    import java.io.IOException;

    public class DisableServiceAccount {

      public static void main(String[] args) throws IOException {
        // TODO(Developer): Replace the below variables before running.
        String projectId = "your-project-id";
        String serviceAccountName = "your-service-account-name";

        disableServiceAccount(projectId, serviceAccountName);
      }

      // Disables a service account.
      public static void disableServiceAccount(String projectId, String accountName)
              throws IOException {
        String email = String.format("%s@%s.iam.gserviceaccount.com", accountName, projectId);

        // Initialize client that will be used to send requests.
        // This client only needs to be created once, and can be reused for multiple requests.
        try (https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.cloud.iam.admin.v1.IAMClient.html iamClient = https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.cloud.iam.admin.v1.IAMClient.html.create()) {
          iamClient.disableServiceAccount(https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.iam.admin.v1.DisableServiceAccountRequest.html.newBuilder()
                  .setName(String.format("projects/%s/serviceAccounts/%s", projectId, email))
                  .build());

          System.out.println("Disabled service account: " + accountName);
        }
      }
    }

### Python


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM Python API
reference documentation](https://developers.google.com/api-client-library/python/apis/iam/v1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    import time

    from google.cloud import iam_admin_v1
    from google.cloud.iam_admin_v1 import types


    def disable_service_account(project_id: str, account: str) -> types.ServiceAccount:
        """Disables a service account.

        project_id: ID or number of the Google Cloud project you want to use.
        account: ID or email which is unique identifier of the service account.
        """

        iam_admin_client = iam_admin_v1.IAMClient()
        request = types.DisableServiceAccountRequest()
        name = f"projects/{project_id}/serviceAccounts/{account}"
        request.name = name

        iam_admin_client.disable_service_account(request=request)
        time.sleep(5)  # waiting to make sure changes applied

        get_request = types.GetServiceAccountRequest()
        get_request.name = name

        service_account = iam_admin_client.get_service_account(request=get_request)
        if service_account.disabled:
            print(f"Disabled service account: {account}")
        return service_account

### REST


The
`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable`

method immediately disables a service account.


Before using any of the request data,
make the following replacements:

- `PROJECT_ID`: Your Google Cloud project ID. Project IDs are alphanumeric strings, like `my-project`.
- `SA_ID`: The ID of your service account. This can either be the service account's email address in the form `SA_NAME@PROJECT_ID.iam.gserviceaccount.com`, or the service account's unique numeric ID.


HTTP method and URL:

```
POST https://iam.googleapis.com/v1/projects/PROJECT_ID/serviceAccounts/SA_ID:disable
```

To send your request, expand one of these options:

#### curl (Linux, macOS, or Cloud Shell)

> [!NOTE]
> **Note:** The following command assumes that you have logged in to the `gcloud` CLI with your user account by running [`gcloud init`](https://docs.cloud.google.com/sdk/gcloud/reference/init) or [`gcloud auth login`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login) , or by using [Cloud Shell](https://docs.cloud.google.com/shell/docs), which automatically logs you into the `gcloud` CLI . You can check the currently active account by running [`gcloud auth list`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/list).


Execute the following command:

```
curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d "" \
     "https://iam.googleapis.com/v1/projects/PROJECT_ID/serviceAccounts/SA_ID:disable"
```

#### PowerShell (Windows)

> [!NOTE]
> **Note:** The following command assumes that you have logged in to the `gcloud` CLI with your user account by running [`gcloud init`](https://docs.cloud.google.com/sdk/gcloud/reference/init) or [`gcloud auth login`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login) . You can check the currently active account by running [`gcloud auth list`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/list).


Execute the following command:

```
$cred = gcloud auth print-access-token
$headers = @{ "Authorization" = "Bearer $cred" }

Invoke-WebRequest `
    -Method POST `
    -Headers $headers `
    -Uri "https://iam.googleapis.com/v1/projects/PROJECT_ID/serviceAccounts/SA_ID:disable" | Select-Object -Expand Content
```

#### APIs Explorer (browser)


Open the

[method reference page](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable).
The APIs Explorer panel opens on the right side of the page.
You can interact with this tool to send requests.

Complete any required fields and click **Execute**.


If successful, the response body will be empty.

## Enable a service account

After enabling a disabled service account, applications will regain access to
Google Cloud resources through that service account.

You can enable a disabled service account whenever you need to. If you attempt
to enable an already enabled service account, it will have no effect.

### Console

1. In the Google Cloud console, go to the **Service accounts** page.

   [Go to Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Select a project.

3. Click the name of the service account that you want to enable.

4. Under **Service account status** , click **Enable service account** , then
   click **Enable** to confirm the change.

### gcloud

1. In the Google Cloud console, activate Cloud Shell.

   [Activate Cloud Shell](https://console.cloud.google.com/?cloudshell=true)


   At the bottom of the Google Cloud console, a
   [Cloud Shell](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works)
   session starts and displays a command-line prompt. Cloud Shell is a shell environment
   with the Google Cloud CLI
   already installed and with values already set for
   your current project. It can take a few seconds for the session to initialize.
2. Execute the `https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/enable`
   command to enable a service account.

   Command:

   ```
   gcloud iam service-accounts enable SA_NAME@PROJECT_ID.iam.gserviceaccount.com
   ```

   Output:

   ```
   Enabled service account SA_NAME@PROJECT_ID.iam.gserviceaccount.com
   ```

### C++


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM C++ API
reference documentation](https://docs.cloud.google.com/cpp/docs/reference/iam/latest).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    namespace iam = ::google::cloud::iam_admin_v1;
    [](std::string const& name) {
      iam::IAMClient client(iam::MakeIAMConnection());
      google::iam::admin::v1::EnableServiceAccountRequest request;
      request.set_name(name);
      auto response = client.EnableServiceAccount(request);
      if (!response.ok()) throw std::runtime_error(response.message());
      std::cout << "ServiceAccount successfully enabled.\n";
    }

### C#


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM C# API
reference documentation](https://developers.google.com/api-client-library/dotnet/apis/iam/v1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).


    using System;
    using https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.html;
    using Google.Apis.Iam.v1;
    using Google.Apis.Iam.v1.Data;

    public partial class ServiceAccounts
    {
        public static void EnableServiceAccount(string email)
        {
            var credential = https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.GoogleCredential.html.https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.GoogleCredential.html#Google_Apis_Auth_OAuth2_GoogleCredential_GetApplicationDefault()
                .https://docs.cloud.google.com/dotnet/docs/reference/Google.Apis/latest/Google.Apis.Auth.OAuth2.GoogleCredential.html#Google_Apis_Auth_OAuth2_GoogleCredential_CreateScoped_System_Collections_Generic_IEnumerable_System_String__(IamService.Scope.CloudPlatform);
            var service = new IamService(new IamService.Initializer
            {
                HttpClientInitializer = credential
            });

            var request = new EnableServiceAccountRequest();

            string resource = "projects/-/serviceAccounts/" + email;
            service.Projects.ServiceAccounts.Enable(request, resource).Execute();
            Console.WriteLine("Enabled service account: " + email);
        }
    }

### Go


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM Go API
reference documentation](https://pkg.go.dev/cloud.google.com/go/iam/admin/apiv1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    import (
    	"context"
    	"fmt"
    	"io"

    	iam "google.golang.org/api/iam/v1"
    )

    // enableServiceAccount enables a service account.
    func enableServiceAccount(w io.Writer, email string) error {
    	// email:= service-account@your-project.iam.gserviceaccount.com
    	ctx := context.Background()
    	service, err := iam.NewService(ctx)
    	if err != nil {
    		return fmt.Errorf("iam.NewService: %w", err)
    	}

    	request := &iam.EnableServiceAccountRequest{}
    	_, err = service.Projects.ServiceAccounts.Enable("projects/-/serviceAccounts/"+email, request).Do()
    	if err != nil {
    		return fmt.Errorf("Projects.ServiceAccounts.Enable: %w", err)
    	}
    	fmt.Fprintf(w, "Enabled service account: %v", email)
    	return nil
    }

### Java


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM Java API
reference documentation](https://developers.google.com/api-client-library/java/apis/iam/v1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    import com.google.cloud.iam.admin.v1.https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.cloud.iam.admin.v1.IAMClient.html;
    import com.google.iam.admin.v1.https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.iam.admin.v1.EnableServiceAccountRequest.html;
    import java.io.IOException;


    public class EnableServiceAccount {

      public static void main(String[] args) throws IOException {
        // TODO(Developer): Replace the below variables before running.
        String projectId = "your-project-id";
        String serviceAccountName = "your-service-account-name";

        enableServiceAccount(projectId, serviceAccountName);
      }

      // Enables a service account.
      public static void enableServiceAccount(String projectId, String accountName)
              throws IOException {
        String email = String.format("%s@%s.iam.gserviceaccount.com", accountName, projectId);

        // Initialize client that will be used to send requests.
        // This client only needs to be created once, and can be reused for multiple requests.
        try (https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.cloud.iam.admin.v1.IAMClient.html iamClient = https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.cloud.iam.admin.v1.IAMClient.html.create()) {
          iamClient.enableServiceAccount(https://docs.cloud.google.com/java/docs/reference/google-iam-admin/latest/com.google.iam.admin.v1.EnableServiceAccountRequest.html.newBuilder()
                  .setName(String.format("projects/%s/serviceAccounts/%s", projectId, email))
                  .build());

          System.out.println("Enabled service account: " + email);
        }
      }
    }

### Python


To learn how to install and use the client library for IAM, see
[IAM client libraries](https://docs.cloud.google.com/iam/docs/reference/libraries).


For more information, see the
[IAM Python API
reference documentation](https://developers.google.com/api-client-library/python/apis/iam/v1).


To authenticate to IAM, set up Application Default Credentials.
For more information, see

[Before you begin](https://docs.cloud.google.com/iam/docs/service-accounts-disable-enable#before-you-begin).

    import time

    from google.cloud import iam_admin_v1
    from google.cloud.iam_admin_v1 import types


    def enable_service_account(project_id: str, account: str) -> types.ServiceAccount:
        """Enables a service account.

        project_id: ID or number of the Google Cloud project you want to use.
        account: ID or email which is unique identifier of the service account.
        """

        iam_admin_client = iam_admin_v1.IAMClient()
        request = types.EnableServiceAccountRequest()
        name = f"projects/{project_id}/serviceAccounts/{account}"
        request.name = name

        iam_admin_client.enable_service_account(request=request)
        time.sleep(5)  # waiting to make sure changes applied

        get_request = types.GetServiceAccountRequest()
        get_request.name = name

        service_account = iam_admin_client.get_service_account(request=get_request)
        if not service_account.disabled:
            print(f"Enabled service account: {account}")
        return service_account

### REST


The
`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/enable`

method enables a previously disabled service account.


Before using any of the request data,
make the following replacements:

- `PROJECT_ID`: Your Google Cloud project ID. Project IDs are alphanumeric strings, like `my-project`.
- `SA_ID`: The ID of your service account. This can either be the service account's email address in the form `SA_NAME@PROJECT_ID.iam.gserviceaccount.com`, or the service account's unique numeric ID.


HTTP method and URL:

```
POST https://iam.googleapis.com/v1/projects/PROJECT_ID/serviceAccounts/SA_ID:enable
```

To send your request, expand one of these options:

#### curl (Linux, macOS, or Cloud Shell)

> [!NOTE]
> **Note:** The following command assumes that you have logged in to the `gcloud` CLI with your user account by running [`gcloud init`](https://docs.cloud.google.com/sdk/gcloud/reference/init) or [`gcloud auth login`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login) , or by using [Cloud Shell](https://docs.cloud.google.com/shell/docs), which automatically logs you into the `gcloud` CLI . You can check the currently active account by running [`gcloud auth list`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/list).


Execute the following command:

```
curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d "" \
     "https://iam.googleapis.com/v1/projects/PROJECT_ID/serviceAccounts/SA_ID:enable"
```

#### PowerShell (Windows)

> [!NOTE]
> **Note:** The following command assumes that you have logged in to the `gcloud` CLI with your user account by running [`gcloud init`](https://docs.cloud.google.com/sdk/gcloud/reference/init) or [`gcloud auth login`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login) . You can check the currently active account by running [`gcloud auth list`](https://docs.cloud.google.com/sdk/gcloud/reference/auth/list).


Execute the following command:

```
$cred = gcloud auth print-access-token
$headers = @{ "Authorization" = "Bearer $cred" }

Invoke-WebRequest `
    -Method POST `
    -Headers $headers `
    -Uri "https://iam.googleapis.com/v1/projects/PROJECT_ID/serviceAccounts/SA_ID:enable" | Select-Object -Expand Content
```

#### APIs Explorer (browser)


Open the

[method reference page](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/enable).
The APIs Explorer panel opens on the right side of the page.
You can interact with this tool to send requests.

Complete any required fields and click **Execute**.


If successful, the response body will be empty.

<br />

## What's next

- Learn how to [delete and undelete service accounts](https://docs.cloud.google.com/iam/docs/service-accounts-delete-undelete).
- Review the process for [granting IAM roles to all types of principals](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access), including service accounts.
- Explore how you can use [role recommendations](https://docs.cloud.google.com/iam/docs/recommender-overview) to downscope permissions for all principals, including service accounts.
- Understand how to [attach service accounts to resources](https://docs.cloud.google.com/iam/docs/attach-service-accounts).