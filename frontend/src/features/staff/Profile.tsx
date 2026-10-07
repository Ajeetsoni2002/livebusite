import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, EyeOff, Loader2, Trash2, UserRound } from "lucide-react";
import { api, apiUrl, errorMessage } from "../../lib/api";
import { toast } from "../../components/Feedback";
import { ContributorAvatar } from "../community/Leaderboard";

type Profile = {
  name: string;
  visibility: "public" | "anonymous";
  displayName: string;
  bio: string;
  photo: string | null;
  published: number;
};

/** A contributor decides how the public sees them: name and photo, or anonymous. */
export default function ProfilePage() {
  const query = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () =>
      (await api.get("/contributor/profile")).data.data as Profile,
  });
  const [form, setForm] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);
  if (!form)
    return query.isError ? (
      <p className="notice error">{errorMessage(query.error)}</p>
    ) : (
      <p role="status">Loading your profile…</p>
    );
  const anonymous = form.visibility === "anonymous";
  const shownName = anonymous
    ? "Anonymous contributor"
    : form.displayName.trim() || form.name;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api.patch("/contributor/profile", {
        visibility: form.visibility,
        displayName: form.displayName.trim(),
        bio: form.bio.trim(),
      });
      await query.refetch();
      toast(
        anonymous
          ? "Saved. You appear as “Anonymous contributor”."
          : "Saved. Your public profile is updated.",
        "success",
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }
  async function upload(file: File) {
    if (file.size > 3 * 1024 * 1024)
      return toast("Choose a photo under 3 MB.", "error");
    setUploading(true);
    try {
      const data = new FormData();
      data.append("photo", file);
      const photo = (
        await api.post("/contributor/profile/photo", data, { timeout: 60_000 })
      ).data.data.photo;
      setForm((f) => (f ? { ...f, photo } : f));
      toast("Photo updated.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function removePhoto() {
    try {
      await api.delete("/contributor/profile/photo");
      setForm((f) => (f ? { ...f, photo: null } : f));
      toast("Photo removed.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      <div className="section-head">
        <h2>My public profile</h2>
        <span className="muted">
          {form.published} published contribution
          {form.published === 1 ? "" : "s"}
        </span>
      </div>
      <div className="profile-grid">
        <section className="card staff-card profile-card">
          <h3>How should students see you?</h3>
          <div
            className="visibility-choice"
            role="radiogroup"
            aria-label="Profile visibility"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!anonymous}
              className={!anonymous ? "selected" : ""}
              onClick={() => setForm({ ...form, visibility: "public" })}
            >
              <UserRound size={22} aria-hidden />
              <strong>Show my name and photo</strong>
              <span className="muted">
                Credit on the contributors board and on your papers.
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={anonymous}
              className={anonymous ? "selected" : ""}
              onClick={() => setForm({ ...form, visibility: "anonymous" })}
            >
              <EyeOff size={22} aria-hidden />
              <strong>Stay anonymous</strong>
              <span className="muted">
                You still rank on the board as “Anonymous contributor”. Only
                admins see who you are.
              </span>
            </button>
          </div>

          <fieldset className="profile-fields" disabled={anonymous}>
            <div className="photo-row">
              <ContributorAvatar
                name={shownName}
                photo={form.photo ? apiUrl(form.photo) : null}
                anonymous={false}
                size={88}
              />
              <div>
                <strong>Profile photo</strong>
                <p className="muted small">
                  JPEG, PNG or WebP up to 3 MB. It is cropped to a square and
                  location data is removed.
                </p>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => input.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <Loader2 className="spin" size={15} />
                    ) : (
                      <Camera size={15} />
                    )}
                    {form.photo ? "Change photo" : "Upload photo"}
                  </button>
                  {form.photo && (
                    <button
                      type="button"
                      className="danger-text"
                      onClick={removePhoto}
                    >
                      <Trash2 size={15} /> Remove
                    </button>
                  )}
                </div>
                <input
                  ref={input}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) =>
                    e.target.files?.[0] && upload(e.target.files[0])
                  }
                />
              </div>
            </div>
            <label>
              Public name
              <input
                value={form.displayName}
                maxLength={60}
                placeholder={form.name}
                onChange={(e) =>
                  setForm({ ...form, displayName: e.target.value })
                }
              />
              <small className="muted">
                Leave empty to use your account name.
              </small>
            </label>
            <label>
              Short bio (optional)
              <input
                value={form.bio}
                maxLength={160}
                placeholder="e.g. CSE, 3rd year — happy to share end-sem papers"
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
              />
            </label>
          </fieldset>
          <div className="row-actions">
            <button className="button" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : null} Save
              profile
            </button>
          </div>
        </section>

        <aside className="card staff-card profile-preview" aria-label="Preview">
          <span className="eyebrow">PREVIEW ON THE CONTRIBUTORS BOARD</span>
          <div className="leader-card preview-card">
            <span className="leader-rank">01</span>
            <ContributorAvatar
              name={shownName}
              photo={!anonymous && form.photo ? apiUrl(form.photo) : null}
              anonymous={anonymous}
              size={48}
            />
            <div className="leader-main">
              <strong>{shownName}</strong>
              {!anonymous && form.bio.trim() && (
                <span className="leader-bio">{form.bio.trim()}</span>
              )}
            </div>
          </div>
          <p className="muted small">
            Paper credits show “{shownName}”. Admins always see your account
            details.
          </p>
        </aside>
      </div>
    </>
  );
}
