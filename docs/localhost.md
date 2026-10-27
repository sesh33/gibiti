# Run RIVOX Control on your own computer

The cloud machine's loopback address is not your computer. These commands start the application on **the computer where you run them**. No public site is deployed.

Requirements: Node.js **22.19+**, npm, Git and Docker Desktop (or Docker Engine) running. Linux/WSL2 was exercised; Windows users can use WSL2 with Docker Desktop integration.

```sh
git clone https://github.com/sesh33/gibiti.git
cd gibiti
npm ci
npm run local
```

The first run downloads the pinned official Supabase CLI and lightweight official container images. It creates its own local PostgreSQL/Auth bindings, applies migrations, starts Next.js on `127.0.0.1:3000`, and prints the private setup token **file path**, never the token itself. It does not migrate the hosted Supabase project.

1. Open the printed setup address on that computer.
2. Read the private token file locally and paste its value only into the setup form. Do not share it or put it in chat.
3. Choose **Create a new local account**, enter your own email/password/name and confirm the setup.
4. Scan the MFA QR with your authenticator and verify the code.
5. Use Order Center and Offers to synchronize your operation.

Local email invitations are delivered to the local Mailpit inbox, typically on port 54324 of the same computer. They are not sent to real email recipients. The employee accepts the invitation, chooses their own password, and signs in with their assigned permissions. Owner/Admin accounts require MFA.

## Real Eldorado reads

Set these values securely in an ignored `.env.local` on your computer before launching:

```dotenv
ELDORADO_CLIENT_ID=
ELDORADO_CLIENT_SECRET=
```

Use your actual API client values; do not commit the file or send it in chat. The local runner generates and overrides Supabase bindings for the local stack, so hosted Supabase keys are not needed for localhost. Cloud proxy-bound credentials must not be extracted/exported; configure your own values on your computer.

## Start again

Run `npm run local` again. Local data is retained in Docker volumes. Once the Owner exists, use `/login`; the one-time setup cannot replace an existing Owner. To refresh an expired setup window, stop the local Next.js launcher and run it again.

`npm run dev` and `npm start` use the environment you provide directly. For a production build on localhost, run `npm run build` with the intended public bindings, then `npm start`; explicit HTTP loopback origins are supported without disabling secure cookies for hosted HTTPS sites.

The local stack is for private development/validation. Use the hosted deployment checklist before commercial hosting. Local inventory encryption is generated automatically into private `.rivox/inventory.key`; back up that key securely alongside the database. Hosted operation requires a raw private `INVENTORY_ENCRYPTION_KEY`. A rotation/backup procedure must be established before storing real delivery secrets.
