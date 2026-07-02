# How to invite users (allowlist)

PortfolioPilot sign-ups are invite-only. Only emails on the Firestore `allowlist` collection can create a `users/{uid}` account document after registering.

## Add someone to the allowlist

1. Open [Firebase Console](https://console.firebase.google.com) → your project → **Firestore Database**.
2. Open or create the **`allowlist`** collection.
3. Click **Add document**.
4. Set **Document ID** to the invitee's full email address in **lowercase** (e.g. `friend@example.com`).
   - The ID must match exactly what Firebase Auth stores in `request.auth.token.email` when they sign up. Use lowercase to avoid mismatches.
5. Fields are optional — rules only check that the document exists. You may add metadata for your own reference:

   ```json
   {
     "name": "Alex",
     "addedAt": "2026-07-02"
   }
   ```

6. Save the document.

## Invite a friend

1. Add their email to `allowlist` (steps above).
2. Send them the app URL (your Vercel deployment).
3. They choose **Create account** and sign up with **that exact email**.

On success, Firestore will contain `users/{uid}` with `email` and `createdAt`.

## Remove invite access

Delete their document from `allowlist`. This does **not** delete their Firebase Auth account or existing Firestore data — it only prevents new allowlist checks from passing if they were to sign up again. To fully revoke access you would also need to disable or delete their Auth user in the Firebase Console.

## Before deploying allowlist rules

Add your own email (e.g. `nsfx84@gmail.com`) to `allowlist` **before** testing sign-up, or your account creation will be rejected.

## Deploy rule changes

After editing `firestore.rules`:

```powershell
firebase deploy --only firestore:rules
```

## Manual test checklist

1. Signed out: sign up with an email **not** on the allowlist → friendly "not invited" message; no orphaned Auth account.
2. Add that email to `allowlist` in the console.
3. Sign up again with the same email → succeeds; `users/{uid}` doc is created.
4. Sign in with the allowlisted account → app loads normally.
