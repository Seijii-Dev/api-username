const PRIMARY = 'https://europe-west3-storyviewer-7a64d.cloudfunctions.net/getInstagramData';
const FALLBACK = 'https://instagram.abbasofficaldevs.workers.dev/info';
const TIMEOUT = 15000;

function asDict(v: any): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch {
    return null;
  }
}

async function primary(username: string): Promise<any | null> {
  const body = JSON.stringify({
    data: {
      endpoint: '/v1/info',
      params: { include_about: true, username_or_id_or_url: username },
    },
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await withTimeout(
      PRIMARY,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
      },
      TIMEOUT
    );
    if (!r) return null;
    if (r.status === 200) {
      const data: any = await r.json().catch(() => null);
      if (!data) return { found: false };
      const root = asDict(asDict(data.result).data);
      const about = asDict(root.about);
      const apiUser = root.username || about.username;
      const requested = username.trim().replace(/^@/, '');
      const profileId = root.id || about.id;
      const hasData = !!(
        profileId ||
        root.full_name ||
        'follower_count' in root ||
        'media_count' in root
      );
      const matches =
        !apiUser ||
        String(apiUser).trim().replace(/^@/, '').toLowerCase() === requested.toLowerCase();
      if (matches && hasData) {
        const at = Number(root.account_type ?? 1);
        const label =
          ({ 1: 'Personal', 2: 'Creator', 3: 'Business' } as Record<number, string>)[at] ||
          'Personal';
        return {
          found: true,
          data: {
            username: apiUser || requested,
            full_name: root.full_name || about.full_name || '',
            bio: root.biography || about.biography || '',
            followers: Number(root.follower_count ?? about.follower_count ?? 0) || 0,
            following: Number(root.following_count ?? about.following_count ?? 0) || 0,
            posts: Number(root.media_count ?? about.media_count ?? 0) || 0,
            private: !!(root.is_private ?? about.is_private),
            verified: !!(root.is_verified ?? about.is_verified),
            is_business: !!(root.is_business ?? about.is_business) || label === 'Business',
            category: root.category || about.category || '',
            country: about.country || root.country || '',
            date_joined: about.date_joined || root.date_joined || '',
            profile_pic: root.profile_pic_url || about.profile_pic_url || '',
            external_url: root.external_url || about.external_url || '',
            user_id: root.id || about.id || '',
            account_type: label,
            fbid: root.fbid_v2 || '',
          },
        };
      }
      return { found: false };
    }
    if (r.status === 429) {
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
      continue;
    }
    if (r.status === 403 || r.status === 404) return { found: false };
    await new Promise(res => setTimeout(res, 1000));
  }
  return { found: false };
}

async function fallback(username: string): Promise<any | null> {
  const r = await withTimeout(
    `${FALLBACK}?username=${encodeURIComponent(username)}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    },
    TIMEOUT
  );
  if (!r) return null;
  if (r.status === 404) return { found: false };
  if (r.status !== 200) return null;
  const payload: any = await r.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return null;

  let data: any;
  if (payload.success === true && payload.data && typeof payload.data === 'object') data = payload.data;
  else if (payload.error) return { found: false };
  else if (payload.username) data = payload;
  else return null;

  const apiUser = data.username;
  if (!apiUser || String(apiUser).trim().toLowerCase() !== username.trim().toLowerCase()) {
    return { found: false };
  }
  const account = asDict(data.account);
  const stats = asDict(data.stats);
  const profile = asDict(data.profile);
  const contact = asDict(data.contact);
  const location = asDict(data.location);
  const joined = asDict(account.joined);

  const atRaw = account.account_type;
  const labelMap: Record<number, string> = { 1: 'Personal', 2: 'Creator', 3: 'Business' };
  let atLabel = labelMap[Number(atRaw)] || 'Personal';
  if (account.is_creator) atLabel = 'Creator';
  else if (account.is_business) atLabel = 'Business';

  return {
    found: true,
    data: {
      username: apiUser,
      full_name: data.full_name || account.full_name || '',
      bio: data.bio || account.bio || '',
      followers: Number(data.followers ?? stats.followers ?? 0) || 0,
      following: Number(data.following ?? stats.following ?? 0) || 0,
      posts: Number(data.posts ?? stats.posts ?? 0) || 0,
      private: !!account.private,
      verified: !!account.verified,
      is_business: !!account.is_business || !!account.is_creator,
      category: data.category || account.category || '',
      country: data.country || location.country || '',
      date_joined: data.joined_date || joined.date || '',
      profile_pic: data.profile_pic || profile.profile_pic_hd || '',
      external_url: data.external_url || contact.external_url || '',
      user_id: data.user_id || account.id || profile.instagram_pk || '',
      account_type: atLabel,
      fbid: profile.fbid || '',
      former_usernames: data.former_usernames || account.former_usernames || null,
    },
  };
}

export async function lookup(username: string): Promise<any> {
  const p = await primary(username);
  if (p && p.found) return p;
  const f = await fallback(username);
  if (f && f.found) return f;
  if (p === null || f === null) return { success: false, error: 'upstream_unreachable' };
  return { success: false, error: 'not_found' };
}