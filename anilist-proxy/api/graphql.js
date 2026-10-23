export default async function handler(req, res) {
  const r = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(req.body),
  });
  res.status(r.status).setHeader("Content-Type", "application/json").send(await r.text());
}