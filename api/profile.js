export const config = { runtime: 'nodejs18.x' };

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const cache = new Map(); // { key: { exp, data } }

function setCache(k, d){ cache.set(k, { exp: Date.now()+CACHE_TTL_MS, data: d }); }
function getCache(k){ const v = cache.get(k); return v && v.exp > Date.now() ? v.data : null; }

export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    const usernameRaw = String(req.query.username || '').trim();
    const username = usernameRaw.replace(/^@/, '').toLowerCase();
    if (!username) return res.status(400).json({ error: 'Missing username' });

    const key = `p:${username}`;
    const hit = getCache(key);
    if (hit) { res.setHeader('Cache-Control', 'public, max-age='+(CACHE_TTL_MS/1000|0)); return res.status(200).json(hit); }

    // Instagram web endpoint (bez přihlášení)
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const r = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
        'x-ig-app-id': '936619743392459',
        'referer': `https://www.instagram.com/${username}/`,
        'origin': 'https://www.instagram.com'
      },
      redirect: 'follow'
    });
    if (!r.ok) return res.status(502).json({ error: 'Upstream status '+r.status });
    const j = await r.json();
    const user = j?.data?.user;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const posts = Array.isArray(user.edge_owner_to_timeline_media?.edges)
      ? user.edge_owner_to_timeline_media.edges.map(e => e.node)
      : [];

    const mapped = {
      username,
      profile: {
        id: user.id,
        is_private: !!user.is_private,
        is_verified: !!user.is_verified,
        followers: Number(user.edge_followed_by?.count || 0),
        following: Number(user.edge_follow?.count || 0),
        posts_count: Number(user.edge_owner_to_timeline_media?.count || 0),
        biography: String(user.biography || ''),
        profile_pic_url: String(user.profile_pic_url_hd || user.profile_pic_url || ''),
        username: user.username
      },
      posts: posts.slice(0, 24).map(n => ({
        id: n.id,
        shortcode: n.shortcode,
        permalink: `https://www.instagram.com/p/${n.shortcode}/`,
        timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp*1000).toISOString() : null,
        type: mapType(n),
        is_video: !!n.is_video,
        video_views: Number(n.video_view_count ?? n.play_count ?? 0) || null,
        thumbnail_url: n.display_url || n.thumbnail_src || '',
        accessibility_caption: n.accessibility_caption || null,
        width: Number(n.dimensions?.width ?? 0) || undefined,
        height: Number(n.dimensions?.height ?? 0) || undefined,
        caption: String(n.edge_media_to_caption?.edges?.[0]?.node?.text || ''),
        likes: Number((n.edge_liked_by?.count ?? n.edge_media_preview_like?.count) || 0),
        comments: Number((n.edge_media_to_parent_comment?.count ?? n.edge_media_to_comment?.count) || 0),
        // Pokud váš scrapper tyto hodnoty doplní, předáme je dál; jinak null
        saves: (n.saves !== undefined && n.saves !== null) ? Number(n.saves) : null,
        shares: (n.shares !== undefined && n.shares !== null) ? Number(n.shares) : null
      })),
      followers_history: []
    };

    setCache(key, mapped);
    res.setHeader('Cache-Control', 'public, max-age='+(CACHE_TTL_MS/1000|0));
    return res.status(200).json(mapped);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: 'Server error' });
  }
}

function mapType(n){
  const typename = String(n?.__typename || '');
  const pt = String(n?.product_type || '').toLowerCase();
  if (pt.includes('clip') || pt.includes('reel')) return 'reel';
  if (typename.includes('GraphVideo')) return 'video';
  if (typename.includes('GraphSidecar')) return 'image';
  if (typename.includes('GraphImage')) return 'image';
  return 'post';
}


