import { api, apiUrl } from "./api";
/** One explicit user action, one idempotency key; same contract as the detail page. */
export async function downloadResource(id: string, kind: string) {
  const response = await api.post(
    `/${kind}/${id}/download`,
    {},
    {
      headers: { "Idempotency-Key": crypto.randomUUID() },
    },
  );
  window.location.assign(apiUrl(response.data.data.url));
}
