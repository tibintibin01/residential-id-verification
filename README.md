# Dipaculao Residential ID verification

Target: https://residential-id.netlify.app

The mobile verification page shows only masked names, the barangay recorded on
the card, a non-identifying reference,
issuance and validity dates, issuing office, and update/publication dates. There
is no resident search, public record list, photo, TIN, date of birth, full address,
or emergency-contact endpoint. Purok is not published. This first release has no staff portal or login;
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

## Scan another ID

The result card includes **Scan another ID** beside **Check again**. On the
home page the same control says **Scan an ID**. It opens a camera dialog only
after the visitor presses the button. The browser asks for camera permission;
microphone access is never requested. A QR-photo option is available when the
camera is unavailable or permission is denied.

Frames and chosen images are decoded on the visitor's device. The decoder is
either the browser's QR implementation or the self-hosted jsQR 1.4.0 fallback
(Apache-2.0, license in `public/vendor/`). No image is uploaded and no external
decoder or CDN is used. The scanner accepts only this site's `/verify#token`
links, without credentials, query parameters, or other destinations. HTTP
loopback links are supported only for matching local previews.

The camera stops on close, successful recognition, page hiding/navigation, or
one minute of inactivity. A late camera permission result after closing is
immediately stopped. Scanning a second token refreshes the result within the
page; an older lookup cannot replace the new card's result.

The CSP permits only same-origin scripts plus local blob images/video. The
Permissions Policy permits the camera for this origin only; microphone and
geolocation remain disabled. Real phone-camera behavior should be checked on
the office's target phones; automated camera tests use fictional frames.

## Barangay projection upgrade

Publisher 1.1 adds `projectionVersion: 2` and a canonical barangay from the
desktop's existing Dipaculao barangay list. Unknown values become null; arbitrary
addresses and purok remain rejected. Existing enrolled rows are republished once
because their projection digest changes. Their issuance revision and QR token
are retained.

The registry accepts a same-revision v1-to-v2 enrichment only when every existing
public business field matches. Equal-version differences still conflict, older
publication versions cannot erase the enriched location, and a revoked record
cannot become active. A newer business correction from a legacy publisher can
temporarily leave barangay unavailable until a v2 publisher republishes that
revision. This avoids presenting a prior barangay as if it belonged to a newer
correction.

Deploy the website before installing publisher 1.1 on the designated server.
The field shows `Not yet available` until its upgraded publisher sends the
barangay. The client remains compatible at 1.3.30, and existing QR links stay
valid. The server update package reuses its saved user-protected connection and
does not start publication until the operator presses Start updated publisher.

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
- [Camera access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [jsQR](https://github.com/cozmo/jsQR)
