---
title: Get started with Cloud Firestore Security Rules
url: https://firebase.google.com/docs/firestore/security/get-started
created_at: 2026-10-07T15:14:07-03:00
updated_at: 2026-10-07T15:14:07-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Get started with Cloud Firestore Security Rules

[Video](https://www.youtube.com/watch?v=eW5MdE3ZcAw)

With Cloud Firestore Security Rules, you can focus on building a great user
experience without having to manage infrastructure or write server-side
authentication and authorization code.

Security rules provide access control and data validation in a simple yet
expressive format. To build user-based and role-based access systems that keep your
users' data safe, you need to use [Firebase
Authentication](https://firebase.google.com/docs/auth/) with Cloud Firestore Security Rules.

<br />


<br />


<br />


<br />

### AI prompt for AI assistance


***For AI assistance, copy the prompt below into your
AI coding agent
(like Gemini in Android Studio, Antigravity, Claude Code, Codex, and Cursor).**
You can customize the prompt and iterate with your agent. Visit
[Firebase agent skills](https://firebase.google.com/docs/ai-assistance/agent-skills)
for detailed installation info.*

```
Help me use Firebase in my app.
1. Make sure that **Firebase agent skills** are installed and updated. For Claude Code, Codex, or Cursor agents, help me install the Firebase plugin. For other agents, run `npx skills add firebase/agent-skills`. Always try to use **Firebase agent skills** for Firebase-related tasks.
2. Help me write, validate, and deploy Firebase Security Rules to protect my app's Firestore data.
```

> [!NOTE]
> **Note:** The server client libraries bypass all Cloud Firestore Security Rules and instead authenticate through [Google Application Default Credentials](https://cloud.google.com/docs/authentication/production). If you're using the server client libraries or the REST or RPC APIs, make sure to set up [Identity and Access Management (IAM) for Cloud Firestore](https://cloud.google.com/firestore/docs/security/iam).

## Security rules version 2

As of May 2019, version 2 of the Cloud Firestore security rules is now
available. Version 2 of the rules changes the behavior of [recursive
wildcards](https://firebase.google.com/docs/firestore/security/rules-structure#recursive_wildcards) `{name=**}`. You must use version 2 if you plan to
use [collection group queries](https://firebase.google.com/docs/firestore/query-data/queries#collection-group-query). You must opt-in to
version 2 by making `rules_version = '2';` the first line in your security
rules:

    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {

## Writing rules

You will write and manage Cloud Firestore Security Rules tailored to the data model you
create for the default database and each additional database in your project.

All Cloud Firestore Security Rules consist of `match` statements, which identify documents in
your database, and `allow` expressions, which control access to those documents:

    service cloud.firestore {
      match /databases/{database}/documents {
        match /<some_path>/ {
          allow read, write: if <some_condition>;
        }
      }
    }

Every database request from a Cloud Firestore mobile/web client library is evaluated against
your security rules before reading or writing any data. If the rules deny access
to any of the specified document paths, the entire request fails.

Below are some examples of basic rule sets. While these rules are valid, they
are not recommended for production applications:

### Auth required

    // Allow read/write access on all documents to any user signed in to the application
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read, write: if request.auth != null;
        }
      }
    }

### Deny all

    // Deny read/write access to all users under any conditions
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read, write: if false;
        }
      }
    }

### Allow all

    // Allow read/write access to all users under any conditions
    // Warning: **NEVER** use this rule set in production; it allows
    // anyone to overwrite your entire database.
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read, write: if true;
        }
      }
    }

The `{document=**}` path used in the examples above matches any document in the
entire database. Continue on to the guide for [structuring security rules](https://firebase.google.com/docs/firestore/security/rules-structure) to
learn how to match specific data paths and work with hierarchical data.

## Testing rules

Cloud Firestore provides a rules simulator that you can use to test your
ruleset. You can access the simulator in both the Google Cloud console and the
Firebase console.

The rules simulator lets you simulate authenticated and unauthenticated reads,
writes, and deletes. When you simulate an authenticated request, you can build
and preview authentication tokens from various providers. Simulated requests
run against the ruleset in your editor, not your deployed ruleset.

> [!NOTE]
> **Note:** To fully validate your app's behavior and verify your security rules configurations, use the Local Emulator Suite to run and automate unit tests in a local environment.

### Test rules in the Google Cloud console

The rules simulator in the Google Cloud console is available for
Firestore in Native mode in both the Standard and Enterprise editions.

#### Required permissions

To test security rules in the Google Cloud console, you need the following
IAM permission:

- `firebaserules.rulesets.test`

To simulate a database request in the Google Cloud console:

1. In the Google Cloud console, go to the **Databases** page.
2. Click the ID of the database you want to test.
3. In the navigation menu, click **Security**.
4. Click the **Simulator** tab.
5. In the **Simulation type** drop-down list, select an operation type: **get** , **create** , **update** , or **delete**.
6. In the **Location** field, enter the document path you want to test (for example, `users/user_123`).
7. (Optional) For **create** and **update** requests, click **Build document** to configure the mock document payload.
8. (Optional) To simulate an authenticated request, turn on **Authentication** , select an authentication provider (such as **google.com** or **Anonymous**), and configure the token payload fields.
9. Click **Run**.

The evaluation panel displays whether the request was allowed or denied,
detailed report items for each condition evaluated, and line-level highlights
in the code editor.

### Test rules in the Firebase console

To test rules in the Firebase console, go to the **Databases \& Storage** \>
**Firestore** \> [**Rules** tab](https://console.firebase.google.com/project/_/firestore/rules). Click **Rules Playground**
to open the simulator settings, select your simulation options, and then click
**Run**.

## Deploying rules

Before you can start using Cloud Firestore from your mobile app, you'll
need to deploy security rules. You can deploy rules in the Firebase console,
in the Google Cloud console, using the Firebase CLI, or with the
Cloud Firestore management REST API.

Updates to Cloud Firestore Security Rules can take up to a minute to affect new queries and
listeners. However, it can take up to 10 minutes to fully propagate the changes
and affect any active listeners.

> [!NOTE]
> **Note:** **When you
> [deploy security rules using the Firebase CLI](https://firebase.google.com/docs/cli/#deployment),
> the rules defined in your project directory overwrite any existing rules in the
> Firebase console.** So, if you choose to define or edit your security rules using the Firebase console, make sure that you also update the rules defined in your project directory.

### Use the Firebase console

To set up and deploy your first set of rules, for the default database in your
project, go to the **Databases \& Storage** \> **Firestore** \>
[**Rules** tab](https://console.firebase.google.com/project/_/firestore/rules) in the Firebase console.

If you create multiple databases for your project, you can deploy
Cloud Firestore Security Rules for each database. In the Firebase console, use the
database selector to switch between the default database and any
additional databases.

Write your rules in the online editor, then click **Publish**.

### Use the Google Cloud console

You can manage and deploy Cloud Firestore Security Rules directly in the
Google Cloud console. The rules editor is available for
Firestore in Native mode in both the Standard and Enterprise editions.

> [!NOTE]
> **Note:** The Google Cloud console doesn't support deployment of Cloud Firestore Security Rules to the `(default)` database. To manage rules for the `(default)` database, use the [Firebase console](https://firebase.google.com/docs/firestore/security/get-started#use-the-firebase-console) or the [Firebase CLI](https://firebase.google.com/docs/firestore/security/get-started#use_the_cli).

#### Required permissions

To manage and deploy security rules in the Google Cloud console, you need the
following IAM permissions:

- `firebaserules.releases.create`
- `firebaserules.releases.delete`
- `firebaserules.releases.update`
- `firebaserules.rulesets.create`
- `firebaserules.rulesets.delete`
- `firebaserules.rulesets.list`
- `firebaserules.rulesets.test` (required to use the rules simulator)

To deploy rules in the Google Cloud console:

1. In the Google Cloud console, go to the **Databases** page.
2. Click the ID of the database you want to manage.
3. In the navigation menu, click **Security**.
4. Click the **Firestore Rules** tab.
5. In the rules editor, view your rules. To edit, click **New ruleset** or **Clone ruleset**, and then modify your rules.
6. Click **Publish** to deploy your changes.

You can also view previous rulesets in the timeline and clone or restore them.

### Use the Firebase CLI

You can also deploy rules using the [Firebase
CLI](https://firebase.google.com/docs/cli). Using the CLI allows you to keep
your rules under version control with your application code and deploy rules as
part of your existing deployment process.

    // Set up Firestore in your project directory, creates a .rules file
    firebase init firestore

    // Edit the generated .rules file to your desired security rules
    // ...

    // Deploy rules for all configured databases
    firebase deploy --only firestore

## Enhance security for Cloud Storage

Your apps will benefit from the robust database features of Cloud Firestore
and the file storage and management features of Cloud Storage. Used
together, these products also provide reinforcing app security, since
Cloud Firestore can capture authorization requirements usable by Firebase Security Rules
for both products. For more, see the [guide for Cloud Storage](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_firestore).


## Next steps

- Learn how to [structure security rules](https://firebase.google.com/docs/firestore/security/rules-structure).
- Write [custom security rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).
- Read the [security rules reference](https://firebase.google.com/docs/reference/rules/rules).
