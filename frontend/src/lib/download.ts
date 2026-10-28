import { api, apiUrl } from "./api";
import { toast } from "../components/Feedback";
import { RATE } from "./earn";
/** One explicit user action, one idempotency key; same contract as the detail page. */
export async function downloadResource(id: string, kind: string) {
  const response = await api.post(
    `/${kind}/${id}/download`,
    { page: window.location.pathname.slice(0, 240) },
    {
      headers: { "Idempotency-Key": crypto.randomUUID() },
    },
  );
  window.location.assign(apiUrl(response.data.data.url));
  toast(
    `Download started. Got old papers or notes? Upload them and earn ₹${RATE} for each approved one.`,
    "success",
  );
}
