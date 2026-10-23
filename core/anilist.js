const __name = (fn, _) => fn;

var resolved = new Map();
var inflight = new Map();
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var ARM = "https://arm.haglund.dev/api/v2/ids";
var ANILIST_WEB = "https://anilist.co";
var JIKAN = "https://api.jikan.moe/v4";

const AL_STATUS_MAP = {
  RELEASING: "RELEASING",
  FINISHED: "FINISHED",
  NOT_YET_RELEASED: "NOT_YET_RELEASED",
  CANCELLED: "FINISHED",
  HIATUS: "HIATUS",
};

const JIKAN_STATUS_MAP = {
  "Currently Airing": "RELEASING",
  "Finished Airing": "FINISHED",
  "Not yet aired": "NOT_YET_RELEASED",
};

function cookiesFromHeaders(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

async function mediaFromResponse(res) {
  if (!res?.ok) return null;
  try {
    const json = await res.json();
    return json.data?.Media ?? null;
  } catch {
    return null;
  }
}

async function fetchFromAniListWeb(body) {
  const home = await fetch(`${ANILIST_WEB}/`, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  }).catch(() => null);
  if (!home?.ok) return null;
  const html = await home.text();
  const token = html.match(/window\.al_token\s*=\s*"([^"]+)"/)?.[1];
  const cookie = cookiesFromHeaders(home.headers);
  if (!token || !cookie) return null;
  const res = await fetch(`${ANILIST_WEB}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `${ANILIST_WEB}/home`,
      "x-csrf-token": token,
      schema: "default",
      Cookie: cookie,
    },
    body,
  }).catch(() => null);
  return mediaFromResponse(res);
}

async function fetchFromAniList(id) {
  const fullQuery = `query($id:Int){Media(id:$id,type:ANIME){id idMal title{english romaji native} status format episodes seasonYear startDate{year} genres synonyms nextAiringEpisode{episode airingAt timeUntilAiring}}}`;
  const body = JSON.stringify({ query: fullQuery, variables: { id } });
  let res;
  try {
    res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA },
      body,
    });
  } catch (e) {
    throw new Error("AniList fetch failed: " + e.message);
  }
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 200);
    throw new Error("AniList status " + res.status + ": " + txt);
  }
  return await mediaFromResponse(res) ?? fetchFromAniListWeb(body);
}

async function fetchFromJikan(malId) {
  let res;
  for (let i = 0; i < 2; i++) {
    res = await fetch(`${JIKAN}/anime/${malId}/full`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (!res.ok) throw new Error("Jikan status " + res.status + " for MAL ID " + malId);
  const d = (await res.json()).data;
  if (!d) throw new Error("Jikan returned no data for MAL ID " + malId);
  const from = d.aired?.prop?.from ?? {};
  return {
    idMal: d.mal_id,
    title: { english: d.title_english ?? null, romaji: d.title ?? null, native: d.title_japanese ?? null },
    status: JIKAN_STATUS_MAP[d.status] ?? "RELEASING",
    format: d.type ? String(d.type).toUpperCase().replace(/\s+/g, "_") : null,
    episodes: d.episodes ?? null,
    seasonYear: d.year ?? from.year ?? null,
    startDate: { year: from.year ?? null, month: from.month ?? null, day: from.day ?? null },
    nextAiringEpisode: null,
    genres: Array.isArray(d.genres) ? d.genres.map((g) => g.name) : [],
    synonyms: Array.isArray(d.title_synonyms) ? d.title_synonyms : [],
  };
}

async function getMedia(anilistId) {
  const id = Number(anilistId);
  if (resolved.has(id)) return resolved.get(id);
  if (inflight.has(id)) return inflight.get(id);
  const promise = (async () => {
    const arm = await fetch(`${ARM}?source=anilist&id=${id}`, {
      headers: { "User-Agent": UA, "Accept": "application/json" }
    }).then((r) => {
      if (!r.ok) return null;
      return r.json();
    }).catch(() => null);

    let al = null;
    let alErr = null;
    try {
      al = await fetchFromAniList(id);
    } catch (e) {
      alErr = e;
    }
    if (!al) {
      const malId = arm?.myanimelist;
      if (!malId) throw new Error(`No data found for AniList ID ${id} (AniList: ${alErr?.message ?? "empty"}; ARM returned no MAL ID)`);
      al = await fetchFromJikan(malId);
    }
    const media = {
      id,
      idMal: al.idMal ?? arm?.myanimelist ?? null,
      title: {
        english: al.title?.english ?? null,
        romaji: al.title?.romaji ?? null,
        native: al.title?.native ?? null,
      },
      status: AL_STATUS_MAP[al.status] ?? al.status ?? "RELEASING",
      format: al.format ?? null,
      episodes: al.episodes ?? null,
      seasonYear: al.seasonYear ?? null,
      startDate: al.startDate ?? null,
      nextAiringEpisode: al.nextAiringEpisode ?? null,
      genres: Array.isArray(al.genres) ? al.genres : [],
      synonyms: Array.isArray(al.synonyms) ? al.synonyms : [],
    };
    resolved.set(id, media);
    inflight.delete(id);
    return media;
  })().catch((e) => {
    inflight.delete(id);
    throw e;
  });
  inflight.set(id, promise);
  return promise;
}
__name(getMedia, "getMedia");

function forgetMedia(anilistId) {
  resolved.delete(Number(anilistId));
}

export { getMedia, forgetMedia };
