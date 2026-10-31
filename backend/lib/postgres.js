'use strict';

const { scriptText } = require('./records');
const linkColumns = require('../spec/row_columns.json');

const str = value => typeof value === 'string' && value.trim() ? value : null;
const joined = value => Array.isArray(value) && value.length ? value.join(', ') : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const integer = value => Number.isInteger(value) ? value : null;

function placeRow(userId, place, sqliteRow) {
  const source = place.source;
  const stored = JSON.parse(sqliteRow.data);
  const script = place.script;
  const comments = place.comments;
  const sentiment = comments?.sentiment;
  const row = {
    user_id: userId,
    video_id: source.videoId,
    restaurant_id: place.restaurant_id,
    doc_id: place.id,
    cate_id: integer(place.cate_id),
    thumbnail_url: str(place.thumbnail_url),
    create_time: sqliteRow.create_time,
    update_time: sqliteRow.update_time,
    url: place.sharedUrl || source.videoUrl,
    place_index: integer(source.venueIndex),
    platform: source.platform,
    media: source.media,
    video_url: str(source.videoUrl),
    shared_url: str(place.sharedUrl),
    title: str(source.videoTitle),
    channel: str(source.channel),
    analysis_mode: str(source.analysisMode),
    model: str(source.model),
    prompt_version: str(source.promptVersion),
    analysis_created_at: source.analysisCreatedAt || null,
    cache_hit: source.cacheHit === true,
    restaurant_name: str(place.display.name),
    dish: str(place.display.dish),
    location: str(place.display.location),
    price: str(place.display.price),
    cate_name: str(place.cate_name),
    cate_name_en: str(place.cate_name_en),
    address: str(place.address),
    address_text: str(place.address_text),
    price_text: str(place.price_text),
    price_vnd: integer(place.price_vnd),
    price_vnd_max: integer(place.price_vnd_max),
    price_inferred: place.price_inferred == null ? null : place.price_inferred === true,
    match_score: integer(place.matchScore),
    latitude: number(place.latitude),
    longitude: number(place.longitude),
    geo_source: str(place.geoSource),
    maps_url: str(place.mapsSearchUrl),
    maps_note: str(place.mapsNote),
    shopeefood_url: str(place.shopeeFoodUrl),
    shopeefood_search_url: str(place.shopeeFoodSearchUrl),
    has_conflict: place.hasConflict === true,
    conflict_fields: joined(place.conflictFields),
    incomplete: place.incomplete === true,
    missing_fields: joined(place.missingFields),
    user_note: str(place.userNote),
  };
  for (const [field, prefix] of [['restaurant_name', 'name'], ['dish', 'dish'], ['location', 'location'], ['price', 'price']]) {
    const value = place.venue?.[field] || {};
    row[`${prefix}_status`] = str(value.status);
    row[`${prefix}_agreement`] = str(value.agreement);
    for (let index = 0; index < 2; index++) {
      const entry = value.entries?.[index];
      const suffix = index ? '_2' : '';
      for (const [column, key] of [['value', 'value'], ['origin', 'origin'], ['source', 'source'], ['source_detail', 'source_detail'], ['confidence', 'confidence'], ['evidence', 'evidence'], ['timestamp', 'timestamp']]) {
        row[`${prefix}_${column}${suffix}`] = str(entry?.[key]);
      }
      row[`${prefix}_evidence_checked${suffix}`] = entry?.evidence_checked == null ? null : entry.evidence_checked === true;
      if (prefix === 'price') {
        row[`price_norm_vnd${suffix}`] = number(entry?.normalized?.min) == null ? null : Math.round(entry.normalized.min);
        row[`price_norm_vnd_max${suffix}`] = number(entry?.normalized?.max) == null ? null : Math.round(entry.normalized.max);
        row[`price_norm_currency${suffix}`] = str(entry?.normalized?.currency);
        row[`price_norm_inferred${suffix}`] = entry?.normalized?.inferred == null ? null : entry.normalized.inferred === true;
        row[`price_norm_basis${suffix}`] = str(entry?.normalized?.basis);
      }
    }
  }
  Object.assign(row, {
    script_status: str(script?.status),
    script_reason: str(script?.reason),
    script_lines: script?.lines ? script.lines.length : null,
    script_text: scriptText(place),
    comments_status: str(comments?.status),
    comments_reason: str(comments?.reason),
    comments_count: comments?.items ? comments.items.length : null,
    comments_mood: str(sentiment?.overall),
    comments_rated: integer(sentiment?.rated),
    comments_positive: integer(sentiment?.positive),
    comments_negative: integer(sentiment?.negative),
    comments_neutral: integer(sentiment?.neutral),
    comments_mixed: integer(sentiment?.mixed),
    comments_text: comments?.items?.length ? comments.items.map(item => `[${item.sentiment || 'unrated'}] (${item.likes} likes) ${item.text}`).join(' / ') : null,
    search_text: str(place.searchText),
    schema_version: integer(stored.schemaVersion),
    token_issued_at: stored.tokenIssuedAt || null,
    ai_extracted_unverified: true,
    saved_via: str(place.savedVia),
    is_saved: sqliteRow.is_saved === 1,
    shopeefood_kinds: place.shopeeFoodUrl ? 'store' : place.shopeeFoodSearchUrl ? 'search' : null,
  });
  return row;
}

function insertStatement(table, columns, conflict, updates) {
  const values = columns.map((_, index) => `$${index + 1}`).join(', ');
  return `INSERT INTO public.${table} (${columns.join(', ')}) VALUES (${values}) ON CONFLICT ${conflict} DO UPDATE SET ${updates}`;
}

function createPostgres(config, { pool, logger = console } = {}) {
  if (!config.pgWriteEnabled) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      host: config.pgHost, port: config.pgPort, database: config.pgDatabase,
      user: config.pgUser, password: config.pgPassword,
      ssl: config.pgSsl ? { rejectUnauthorized: true } : false,
      max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    });
    pool.on('error', error => logger.error('postgres idle connection error', error?.code || 'unknown'));
  }
  const linkInsertColumns = ['user_id', ...linkColumns];
  const linkUpdate = [...linkColumns.filter(column => column !== 'url').map(column => `${column}=EXCLUDED.${column}`), 'updated_at=NOW()'].join(', ');
  const linkSql = insertStatement('hackathon_video_places', linkInsertColumns, '(user_id, url)', linkUpdate);

  async function writeExtract(email, name, link, places, sqliteRows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query(
        `INSERT INTO public.user_dim (user_email, user_name)
         VALUES ($1, $2)
         ON CONFLICT (lower(user_email)) DO UPDATE
         SET user_name=COALESCE(EXCLUDED.user_name, user_dim.user_name)
         RETURNING user_id`,
        [email.trim().toLowerCase(), str(name)]
      );
      const userId = user.rows[0].user_id;
      await client.query(linkSql, [userId, ...linkColumns.map(column => link[column] ?? null)]);
      for (const [index, place] of places.entries()) {
        const row = placeRow(userId, place, sqliteRows[index]);
        const columns = Object.keys(row);
        const updates = columns.filter(column => !['user_id', 'video_id', 'restaurant_id', 'is_saved', 'saved_via', 'create_time', 'update_time', 'user_note'].includes(column)).map(column => `${column}=EXCLUDED.${column}`);
        updates.push('is_saved=quan_hackathon_video_places.is_saved');
        updates.push("saved_via=CASE WHEN quan_hackathon_video_places.saved_via='app' THEN 'app' ELSE EXCLUDED.saved_via END");
        updates.push('create_time=quan_hackathon_video_places.create_time');
        updates.push('update_time=CASE WHEN quan_hackathon_video_places.is_saved THEN quan_hackathon_video_places.update_time ELSE EXCLUDED.update_time END');
        updates.push('user_note=COALESCE(EXCLUDED.user_note, quan_hackathon_video_places.user_note)');
        updates.push('synced_at=NOW()');
        const sql = insertStatement('quan_hackathon_video_places', columns, '(user_id, video_id, restaurant_id)', updates.join(', '));
        await client.query(sql, columns.map(column => row[column]));
        if (['ok','partial'].includes(place.comments?.status)) {
          await client.query(
            'DELETE FROM public.quan_hackathon_video_comments WHERE video_id=$1 AND merchant_id=$2',
            [row.video_id, row.restaurant_id]
          );
          for (const [commentIndex, comment] of place.comments.items.entries()) {
            await client.query(
              `INSERT INTO public.quan_hackathon_video_comments
               (video_id, merchant_id, comment_no, comments, sentiment, likes)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [row.video_id, row.restaurant_id, commentIndex + 1, comment.text, comment.sentiment, comment.likes]
            );
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
  return { writeExtract, close: () => pool.end() };
}

module.exports = { createPostgres, placeRow };
