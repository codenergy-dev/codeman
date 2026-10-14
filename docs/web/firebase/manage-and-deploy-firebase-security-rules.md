---
title: Manage and deploy Firebase Security Rules
url: https://firebase.google.com/docs/rules/manage-deploy
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Manage and deploy Firebase Security Rules

Firebase provides you with several tools to manage your Security Rules, each
one useful in particular cases, and each one using the same backend Firebase
Security Rules management API.

No matter which tool is used to invoke it, the management API:

- Ingests a Rules *source* : a set of rules, typically a code file containing Firebase Security Rules statements.
- Stores ingested source as an immutable *ruleset*.
- Tracks deployment of each ruleset in a *release*. Firebase Security Rules-enabled services lookup the release for a project to evaluate each request for a secured resource.
- Provides the capability to run syntactic and semantic *tests* of a ruleset.

## Use the Firebase CLI

With the [Firebase CLI](https://firebase.google.com/docs/cli), you can
upload local *sources* and deploy *releases* . The CLI's
Firebase Local Emulator Suite lets you perform full local testing of *sources*.

Using the CLI allows you to keep your rules under version control with your
application code and deploy rules as part of your existing deployment process.

### Generate a configuration file

When you configure your Firebase project using the Firebase CLI, you create
a `.rules` configuration file in your project directory. Use the following
command to start configuring your Firebase project:

### Cloud Firestore

```
// Set up Firestore in your project directory, creates a .rules file
firebase init firestore
```

### Realtime Database

```
// Set up Realtime Database in your project directory, creates a .rules file
firebase init database
```

### Cloud Storage

```
// Set up Storage in your project directory, creates a .rules file
firebase init storage
```

### Edit and update your rules

Edit your rules source directly in the `.rules` configuration file.

Make sure that any edits you make in the Firebase CLI are reflected in the
Firebase console, or that you consistently make updates using either the
Firebase console or the Firebase CLI. Otherwise, you might overwrite any
updates made in the Firebase console.

> [!NOTE]
> **Note:** **When you
> [deploy security rules using the Firebase CLI](https://firebase.google.com/docs/cli/#deployment),
> the rules defined in your project directory overwrite any existing rules in the
> Firebase console.** So, if you choose to define or edit your security rules using the Firebase console, make sure that you also update the rules defined in your project directory.

### Test your updates

The Local Emulator Suite provides emulators for all Security Rules-enabled
products. The Security Rules engine for each emulator performs both syntactic
and semantic evaluation of rules, thus exceeding the syntactic testing the
Security Rules management API offers.

If you're working with the CLI, the Suite is an excellent tool for Firebase Security Rules
testing. Use the [Local Emulator Suite](https://firebase.google.com/docs/rules/emulator-setup) to test your updates
locally and confirm that your app's Security Rules exhibit the behavior you
want.

### Deploy your updates

Once you've updated and tested your Security Rules, deploy the sources to
production.

For Cloud Firestore Security Rules, associate `.rules` files with your default and
additional named databases by reviewing and updating your
[`firebase.json` file](https://firebase.google.com/docs/cli#the_firebasejson_file).

Use the following commands to selectively deploy your Security Rules alone or
deploy them as part of your normal deployment process.

### Cloud Firestore

```
// Deploy rules for all databases configured in your firebase.json
firebase deploy --only firestore:rules

// Deploy rules for the specified database configured in your firebase.json
firebase deploy --only firestore:<databaseId>
```

### Realtime Database

```
// Deploy your .rules file
firebase deploy --only database
```

### Cloud Storage

```
// Deploy your .rules file
firebase deploy --only storage
```

## Use the Firebase console

> [!NOTE]
> **Note:** The Firebase console supports deployment of Cloud Firestore Security Rules to your project's default database. Future updates will allow you to deploy Security Rules to additional databases in your project. You can use the [Firebase CLI](https://firebase.google.com/docs/rules/manage-deploy#use_the) to work with Security Rules in your multi-database projects.

You can also edit Security Rules *sources* and deploy them as *releases* from
the Firebase console. Syntactic *testing* is performed as you edit in the
Firebase console UI, and semantic testing is available using the
Security Rules Playground.

### Edit and update your rules

1. Open the [Firebase console](https://console.firebase.google.com/) and select your project.
2. Then, select **Realtime Database** , **Cloud Firestore** or **Storage** from the product navigation, then click **Rules** to navigate to the Security Rules editor.
3. Edit your rules directly in the editor.

> [!NOTE]
> **Note:** **When you
> [deploy security rules using the Firebase CLI](https://firebase.google.com/docs/cli/#deployment),
> the rules defined in your project directory overwrite any existing rules in the
> Firebase console.** So, if you choose to define or edit your security rules using the Firebase console, make sure that you also update the rules defined in your project directory.

### Test your updates

In addition to testing syntax in the editor UI, you can test semantic
Security Rules behavior, using your project's database and storage resources,
directly in the Firebase console, using the
[Security Rules Playground](https://firebase.google.com/docs/rules/simulator). Open the **Rules Playground**
screen in the Security Rules editor, modify the settings and click **Run**.
Look for the confirmation message at the top of the editor.

### Deploy your updates

Once you're satisfied that your updates are what you expect, click **Publish**.

## Use the Admin SDK

> [!NOTE]
> **Note:** The Firebase Admin SDK currently supports deployment of Cloud Firestore Security Rules to your project's default database. Future updates will allow you to deploy Security Rules to additional databases in your project. You can use the [Firebase CLI](https://firebase.google.com/docs/rules/manage-deploy#use_the) to work with Security Rules in your multi-database projects.

You can use the Admin SDK for Node.js
*rulesets*. With this programmatic access, you can:

- Implement custom tools, scripts, dashboards and CI/CD pipelines for managing rules.
- Manage rules more easily across multiple Firebase projects.

When updating rules programmatically, it is very important to avoid making
unintended changes to the access control for your app. Write your
Admin SDK code
with security foremost in mind, especially when updating or deploying rules.

Another important thing to keep in mind is that Firebase Security Rules releases take a
period of several minutes to fully propagate. When using the Admin SDK to deploy
rules, make sure to avoid race conditions in which your app immediately relies
on rules whose deployment is not yet complete. If your use case requires
frequent updates to access control rules, consider solutions using Cloud Firestore,
which is designed to reduce race conditions despite frequent updates.

> [!NOTE]
> **Note:** Although it's now possible to unit test your rules using the local Cloud Firestore and Realtime Database emulators, testing is not available via this SDK. If you want to make sure that your rules are tested before deployment, we don't recommend updating your rules via the Admin SDK.

Also note these limits:

- Rules must be smaller than 256 KiB of UTF-8 encoded text when serialized.
- A project can have at most 2500 total deployed rulesets. Once this limit is reached, you must delete some old rulesets before creating new ones.

### Create and deploy Cloud Storage or Cloud Firestore rulesets

A typical workflow for managing security rules with the Admin SDK could include
three discrete steps:

1. Create a rules file source (optional)
2. Create a ruleset
3. Release, or deploy, the new ruleset

The SDK provides a method to combine these steps into a single API call for
Cloud Storage and Cloud Firestore security rules. For example:

        const source = `service cloud.firestore {
          match /databases/{database}/documents {
            match /carts/{cartID} {
              allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerUID;
              allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.ownerUID;
            }
          }
        }`;
        // Alternatively, load rules from a file
        // const fs = require('fs');
        // const source = fs.readFileSync('path/to/firestore.rules', 'utf8');

        await admin.securityRules().releaseFirestoreRulesetFromSource(source);

This same pattern works for Cloud Storage rules with `releaseFirestoreRulesetFromSource()`.

Alternatively, you can create the rules file as an in-memory object, create the
ruleset, and deploy the ruleset separately for closer control of these events.
For example:

        const rf = admin.securityRules().createRulesFileFromSource('firestore.rules', source);
        const rs = await admin.securityRules().createRuleset(rf);
        await admin.securityRules().releaseFirestoreRuleset(rs);

### Update Realtime Database rulesets

To update Realtime Database rulesets with the Admin SDK, use the `getRules()` and
`setRules()` methods of `admin.database`. You can retrieve rulesets in JSON
format, or as a string with comments included.

To update a ruleset:

        const source = `{
          "rules": {
            "scores": {
              ".indexOn": "score",
              "$uid": {
                ".read": "$uid == auth.uid",
                ".write": "$uid == auth.uid"
              }
            }
          }
        }`;
        await admin.database().setRules(source);

### Manage rulesets

To help manage large rulesets, the Admin SDK lets you list all existing rules
with `admin.securityRules().listRulesetMetadata`. For example:

        const allRulesets = [];
        let pageToken = null;
        while (true) {
          const result = await admin.securityRules().listRulesetMetadata(pageToken: pageToken);
          allRulesets.push(...result.rulesets);
          pageToken = result.nextPageToken;
          if (!pageToken) {
            break;
          }
        }

For very large deployments that reach the 2500 ruleset limit over time, you can
create logic to delete the oldest rules on a fixed time cycle. For example, to
delete *all* rulesets deployed for longer than 30 days:

        const thirtyDays = new Date(Date.now() - THIRTY_DAYS_IN_MILLIS);
        const promises = [];
        allRulesets.forEach((rs) => {
          if (new Date(rs.createTime) < thirtyDays) {
            promises.push(admin.securityRules().deleteRuleset(rs.name));
          }
        });
        await Promise.all(promises);
        console.log(`Deleted ${promises.length} rulesets.`);

## Use the REST API

The tools described above are well suited to various workflows, including
Firebase Security Rules management for multiple Cloud Firestore databases in your project,
but you may want to manage and deploy Firebase Security Rules using the management API itself.
The management API gives you the greatest flexibility.

> [!NOTE]
> **Note:** This section covers basic management use cases similar to those presented above. For more use cases and examples available with this API, refer to the complete Rules management REST API reference documentation.

Also note these limits:

- Rules must be smaller than 256 KiB of UTF-8 encoded text when serialized.
- A project can have at most 2500 total deployed rulesets. Once this limit is reached, you must delete some old rulesets before creating new ones.

### Create and deploy Cloud Firestore or Cloud Storage rulesets with REST

The examples in this section use Firestore Security Rules, though they apply to
Cloud Storage Security Rules as well.

The examples also use cURL to make API calls. Steps to set up and pass
authentication tokens are omitted. You can experiment with this API using the
API Explorer integrated with the
reference documentation.

Typical steps for creating and deploying a ruleset using the management API are:

1. Create rules file sources
2. Create a ruleset
3. Release (deploy) the new ruleset.

#### Create a source

Let's assume you're working on your `secure_commerce` Firebase project and want
to deploy locked-down Cloud Firestore Security Rules to a database in your
project named `east_store`.

You can implement these rules in a `firestore.rules`
file.

    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read, write: if false;
        }
      }
    }

#### Create a ruleset

Now, generate a base64-encoded fingerprint for this file. You can then use the
source in this file to populate the payload needed to create a ruleset with the
`projects.rulesets.create` REST call. Here, use the `cat` command to insert
the contents of `firestore.rules` into the REST payload.

For tracking, to associate this with your `east_store` database, set the `attachment_point` to `east_store`.

    curl -X POST -d '{
      "source": {
        "files": [
          {
            "content": "' $(cat storage.rules) '",
            "name": "firestore.rules",
            "fingerprint": <sha fingerprint>
          },
        "attachment_point": "firestore.googleapis.com/databases/east_store"
        ]
      }
    }' 'https://firebaserules.googleapis.com/v1/projects/secure_commerce/rulesets'

The API returns a validation response and a ruleset name, for example
`projects/secure_commerce/rulesets/uuid123`.

#### Release (deploy) a ruleset

If the ruleset is valid, the final step is to deploy the new ruleset in a named
release.

    curl -X POST -d '{
      "name": "projects/secure_commerce/releases/cloud.firestore/east_store"  ,
      "rulesetName": "projects/secure_commerce/rulesets/uuid123"
    }' 'https://firebaserules.googleapis.com/v1/projects/secure_commerce/releases'

> [!NOTE]
> **Note:** For release to the (default) database, the path `projects//releases/cloud.firestore/(default)` is equivalent to `projects//releases/cloud.firestore`.

Be aware that Firebase Security Rules releases take a period of several minutes to fully
propagate. When using the management REST API to deploy, make sure to avoid race
conditions in which your app immediately relies on rules whose deployment is not
yet complete.

### Update Realtime Database rulesets with REST

Realtime Database provides its own REST interface for managing Security Rules. See
[Managing Firebase Realtime Database Security Rules via REST](https://firebase.google.com/docs/database/rest/app-management).

### Manage rulesets with REST

To help manage large rules deployments, in addition to a REST method for
creating rulesets and releases, the management API provides methods to:

- list, get, and delete *rulesets*
- list, get, and delete rules *releases*

For very large deployments that reach the 2500 ruleset limit over time, you can
create logic to delete the oldest rules on a fixed time cycle. For example, to
delete *all* rulesets deployed for longer than 30 days, you can call the
`projects.rulesets.list` method, parse the JSON list of `Ruleset` objects on
their `createTime` keys, then call `project.rulesets.delete` on the
corresponding rulesets by `ruleset_id`.

### Test your updates with REST

Finally, the management API allows you to run syntactic and semantic tests on
Cloud Firestore and Cloud Storage resources in your production
projects.

> [!NOTE]
> **Note:** Tests run using the REST API use production databases, storage buckets, and related resources. Such testing can incur usage charges. We strongly recommend that you use Firebase Local Emulator Suite to perform Firebase Security Rules testing, since you can run tests on offline, non-production resources without usage charges. See our guide on [testing Firebase Security Rules with Local Emulator Suite](https://firebase.google.com/docs/rules/emulator-setup).

Testing with this component of the API consists of:

1. Defining a `TestSuite` JSON object to represent a set of `TestCase` objects
2. Submitting the `TestSuite`
3. Parsing returned `TestResult` objects

Let's define a `TestSuite` object with a single `TestCase` in a
`testcase.json` file. In this example, we pass the Security Rules
language source inline with the REST payload, alongside the test suite to run
on those rules. We specify a Rules evaluation expectation, and the client
request against which the ruleset is to be tested. You can also specify how
complete the test report is, using value "FULL" to indicate results for all
Security Rules language expressions should be included in the report, including
expressions that were not matched to the request.

```
 {
  "source":
  {
    "files":
    [
      {
        "name": "firestore.rules",
        "content": "service cloud.firestore {
          match /databases/{database}/documents {
            match /users/{userId}{
              allow read: if (request.auth.uid == userId);
            }
            function doc(subpath) {
              return get(/databases/$(database)/documents/$(subpath)).data;
            }
            function isAccountOwner(accountId) {
              return request.auth.uid == accountId 
                  || doc(/users/$(request.auth.uid)).accountId == accountId;
            }
            match /licenses/{accountId} {
              allow read: if isAccountOwner(accountId);
            }
          }
        }"
      }
    ]
  },
  "testSuite":
  {
    "testCases":
    [
      {
        "expectation": "ALLOW",
        "request": {
           "auth": {"uid": "123"},
           "path": "/databases/(default)/documents/licenses/abcd",
           "method": "get"},
        "functionMocks": [
            {
            "function": "get",
            "args": [{"exact_value": "/databases/(default)/documents/users/123"}],
            "result": {"value": {"data": {"accountId": "abcd"}}}
            }
          ]
      }
    ]
  }
}
```

We can then submit this `TestSuite` for evalution with the `projects.test`
method.

    curl -X POST -d '{
        ' $(cat testcase.json) '
    }' 'https://firebaserules.googleapis.com/v1/projects/secure_commerce/rulesets/uuid123:test'

The returned `TestReport` (containing test SUCCESS/FAILURE status, lists of
debug messages, lists of visited Rules expressions and their evaluation reports)
would confirm with status SUCCESS that access is properly allowed.

## Manage permissions for cross-service Cloud Storage Security Rules

If you create Cloud Storage Security Rules that use [Cloud Firestore document contents
to evaluate security conditions](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_firestore),
you'll be prompted in the Firebase console or Firebase CLI to enable
permissions to connect the two products.

If you decide to disable such cross-service security:

1. First, before disabling the feature, edit your rules, removing all
   statements that use Security Rules functions to access Cloud Firestore.
   Otherwise, after the feature is disabled, Security Rules evaluations will
   cause your Storage requests to fail.

2. Use the **IAM** page in the Google Cloud Console to delete the "Firebase
   Rules Firestore Service Agent" role by following the [Cloud guide for
   revoking roles](https://cloud.google.com/iam/docs/granting-changing-revoking-access#revoke-single-role).

   > [!NOTE]
   > **Note:** On the **IAM** page, check the box "Include Google-provided role grants" to view all roles.

   > [!NOTE]
   > **Note:** On the **IAM** page, you should find the Firebase Storage service account, with ID ending in `@gcp-sa-firebasestorage.iam.gserviceaccount.com`. If cross-service Rules are enabled, you will see the "Firebase Rules Firestore Service Agent" role listed.

You will be prompted to re-enable the feature the next time you save
cross-service Rules from the Firebase CLI or the Firebase console.