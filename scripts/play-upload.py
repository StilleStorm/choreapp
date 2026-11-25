"""Usage: python3 scripts/play-upload.py <aab> "<release name>" "<notes pl>" <screenshots dir>
Upload AAB to the closed test track and replace phone screenshots via the
Google Play Developer API. Committing the edit sends it for Google review."""
import json, sys, time, glob, os
import jwt, requests

KEY = os.path.expanduser(os.environ.get("PLAY_SA_KEY", "~/Pobrane/familychores-11226-firebase-adminsdk-fbsvc-37f18dfdfe.json"))
PKG = "app.choreapp.family"
TRACK = "alpha"
AAB, VNAME, NOTES, SHOTS = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

k = json.load(open(KEY))
now = int(time.time())
assertion = jwt.encode({"iss": k["client_email"], "scope": "https://www.googleapis.com/auth/androidpublisher",
                        "aud": k["token_uri"], "iat": now, "exp": now + 3600}, k["private_key"], algorithm="RS256")
tok = requests.post(k["token_uri"], data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}
B = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
U = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}"

def ok(r, what):
    if r.status_code >= 300:
        print(what, "FAILED", r.status_code, r.text[:600]); sys.exit(1)
    return r.json() if r.text else {}

edit = ok(requests.post(f"{B}/edits", headers=H), "edit")["id"]
print("edit", edit)
with open(AAB, "rb") as f:
    b = ok(requests.post(f"{U}/edits/{edit}/bundles?uploadType=media", headers={**H, "Content-Type": "application/octet-stream"}, data=f, timeout=600), "bundle")
vc = b["versionCode"]; print("bundle versionCode", vc)
ok(requests.put(f"{B}/edits/{edit}/tracks/{TRACK}", headers=H, json={"track": TRACK, "releases": [{
    "name": VNAME, "versionCodes": [str(vc)], "status": "completed",
    "releaseNotes": [{"language": "pl-PL", "text": NOTES}]}]}), "track")
print("track updated")
if os.environ.get("CONTACT_EMAIL"):
    d = ok(requests.get(f"{B}/edits/{edit}/details", headers=H), "details")
    d["contactEmail"] = os.environ["CONTACT_EMAIL"]
    ok(requests.put(f"{B}/edits/{edit}/details", headers=H, json=d), "details update")
    print("contact email", d["contactEmail"])
ok(requests.delete(f"{B}/edits/{edit}/listings/pl-PL/phoneScreenshots", headers=H), "delete shots")
for p in sorted(glob.glob(os.path.join(SHOTS, "*.png"))):
    with open(p, "rb") as f:
        ok(requests.post(f"{U}/edits/{edit}/listings/pl-PL/phoneScreenshots?uploadType=media", headers={**H, "Content-Type": "image/png"}, data=f), "shot " + p)
    print("shot", os.path.basename(p))
ok(requests.post(f"{B}/edits/{edit}:commit", headers=H), "commit")
print("committed and sent for review")
