# Dipaculao Residential ID verification

Target: https://residential-id.netlify.app

The mobile verification page shows only masked names, a non-identifying reference,
issuance and validity dates, issuing office, and update/publication dates. There
is no resident search, public record list, photo, TIN, date of birth, full address,
or emergency-contact endpoint. This first release has no staff portal or login;
full records stay in the office application.

## Preview and test

Use Node 22 or later:

```text
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:4173/?demo=1 for clearly marked fictional examples.
The local preview deliberately returns 503 for API calls; it never reads the
office database. `npm run build` checks the deployable files. Netlify bundles
the functions during its build.

## Deploy to the existing Netlify project

1. Import this directory as the project repository, or set it as the base
   directory when using the complete application repository. Keep `netlify.toml`,
   `package.json`, `package-lock.json`, `public/`, `lib/`, and `netlify/` together.
   Do not upload the office database. A simple drag-and-drop upload of `public/`
   installs only the page and will NOT deploy the verification functions.
2. Netlify build command: `npm run build`; publish directory: `public`;
   functions directory: `netlify/functions`; Node version: `22`.
3. Initially leave `REGISTRY_ENABLED` absent or `false`. Review `/?demo=1`.
   Real verification endpoints deliberately return unavailable in this state.
4. In the project's production Functions environment, set:
   - `REGISTRY_ENABLED=true`
   - `REGISTRY_PUBLISH_KEY`: a newly generated random secret, at least 32
     characters. Generate it in a trusted local session; never commit it,
     paste it into chat, or put it in frontend JavaScript.
   - `REGISTRY_REGION=ap-southeast-1` (Singapore). Office data residency and
     retention requirements must be approved before publishing real records.
5. Redeploy after changing function environment values. Keep these values scoped
   to production. Deploy previews cannot access the registry through these APIs.
6. Verify HTTPS, unknown-record 404, unavailable 503, signature rejection 401,
   and fictional signed publication before enabling the desktop setting.

The site-wide Netlify Blobs store uses strong reads and conditional writes to
avoid stale updates replacing newer revisions. It persists across deployments.
It is private storage; only our functions return the approved public projection.
Netlify account users with project access may still access stored blobs.

## Connect the office app

See the accompanying `VERIFICATION_SETUP.md` at the desktop source root. Update
the office sync server and participating workstations together before enabling
web QR. Older sync-server versions omit archive/revocation changes.

QR links use `/verify#<opaque-token>`. The token is derived from the issuance's
random UUID, never from its name, DOB, or sequential ID code. The fragment stays
out of the initial HTTP request and referrer. The page sends it in a POST body
to `/api/verify` and sets no-store and no-referrer policies.

There are no analytics scripts or third-party fonts. Netlify infrastructure may
still retain ordinary request metadata according to the project's settings and
provider policies; do not promise visitors that no network metadata is logged.

## Lifecycle and limitations

- New records are eligible only after the desktop website setting is explicitly
  enabled. Existing records require the operator's `Use web QR for this record`
  action and a reprint. Existing printed text QRs cannot be changed remotely.
- An opted-in correction retains its token. Validity is evaluated in Philippine
  time. An unparseable/missing validity date results in `unconfirmed`, never active.
- Revocation is final for that link; a stale or newer active publication cannot
  reactivate it. New authorization would require a separately designed workflow.
- Until the publisher reaches Netlify, the page reflects its last published
  record. If the office server is off, new or corrected/revoked records cannot
  appear online yet. The screen shows publication time; it is not a live query
  to the office database. Operator procedure must cover urgent revocation outages.
- A successful lookup verifies a registry record, not a physical card or holder.
- This prototype requires hosted platform testing and office privacy approval
  before relying on real records. No real resident records ship in this project.

## References

- [Netlify Functions](https://docs.netlify.com/build/functions/overview/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/)
