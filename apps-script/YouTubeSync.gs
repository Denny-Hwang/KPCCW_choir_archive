/**
 * 중앙아트TV(@JandAArt) 채널 미러링 + 매칭 (§9.4).
 *
 * 곡마다 검색하지 않는다. 채널 전체를 yt_cache에 한 번 미러링한 뒤 로컬에서 매칭한다.
 * search.list가 호출당 100 units인 반면 playlistItems.list는 50개당 1 unit이라,
 * 채널 전체를 훑어도 수십 units에 그친다.
 *
 * 이 구조의 핵심은 비용이 아니라 재실행 가능성이다. 영상 제목 형식은 실제 데이터를
 * 받아보기 전에는 확정할 수 없는데, 캐시가 시트에 있으면 매칭 규칙만 고쳐
 * 할당량을 다시 태우지 않고 몇 번이든 돌릴 수 있다.
 *
 * 사전 조건: Apps Script 편집기 왼쪽 [서비스] + → YouTube Data API v3 (식별자: YouTube).
 * 고급 서비스는 실행하는 사람의 OAuth로 동작하므로 API 키를 따로 두지 않는다.
 */

/** config의 `유튜브채널핸들`이 비어 있을 때 쓰는 기본값. */
var DEFAULT_CHANNEL_HANDLE = 'JandAArt';

/** 6분 실행 제한 전에 안전하게 중단하고 이어서 실행할 수 있게 한다. */
var MAX_RUNTIME_MS = 4.5 * 60 * 1000;

var CACHE_HEADERS = ['videoId', '제목', '재생목록명', 'playlistId',
                     '재생목록내순서', '게시일', '수집일시'];

/**
 * [1단계] 채널 미러링 — 메뉴: 성가 아카이브 > 채널 동기화
 *
 * 시간 제한에 걸리면 RESUME_INDEX를 남기고 중단한다. 다시 실행하면 이어서 진행한다.
 */
function syncChannel() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ss = getSpreadsheet_();
    var playlists = fetchAllPlaylists_(resolveChannelId_(ss));
    var r = mirrorPlaylists_(ss, playlists, 'RESUME_');
    ui.alert('채널 동기화', r.done
      ? '완료.\n\n재생목록 ' + playlists.length + '개, 신규 ' + r.added + '행 추가.\n\n' +
        '이어서 [제목 형식 확인]으로 영상 제목 형식을 눈으로 확인한 뒤 [영상 매칭]을 실행하세요.'
      : '시간 제한으로 중단했습니다.\n\n' +
        '재생목록 ' + r.index + '/' + playlists.length + ' 완료, 신규 ' + r.added + '행 추가.\n' +
        '[채널 동기화]를 다시 실행하면 중단한 지점부터 이어서 진행합니다.',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('동기화 실패', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

/**
 * 업로드 전체 동기화 — 메뉴: 성가 아카이브 > 업로드 전체 동기화
 *
 * 채널 동기화는 재생목록을 따라가는데, playlists.list는 채널이 소유한 공개 재생목록만 준다.
 * 그래서 유튜브에 멀쩡히 있는 영상이 앱에 안 보이는 일이 반복됐다(36·37·38·39·40·41집).
 * 재생목록을 하나씩 찾아 넣는 대신, 채널의 **업로드 목록(UU…)** 을 통째로 받는다.
 * 채널이 올린 공개 영상은 어느 재생목록에 있든 없든 전부 여기 들어 있다.
 *
 * 재생목록명이 "(전체 업로드)"라 집 번호는 영상 제목에서 읽는다 — 제목에 "중앙성가 36집"이
 * 들어 있다. 영상 수가 많아 한 번에 안 끝나면 페이지 토큰을 남기고, 다시 누르면 이어서 간다.
 * 이미 캐시에 있는 영상(같은 videoId|playlistId)은 다시 넣지 않으므로 몇 번을 돌려도 안전하다.
 * 할당량은 50개당 1 unit이라 채널 전체를 받아도 수백 units다(하루 10,000).
 */
function syncUploads() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ss = getSpreadsheet_();
    var uploads = uploadsPlaylist_(resolveChannelId_(ss));
    if (!uploads) {
      ui.alert('채널의 업로드 목록을 찾지 못했습니다. 유튜브채널ID 설정을 확인하세요.');
      return;
    }
    var r = mirrorPlaylists_(ss, [uploads], 'UPLOADS_RESUME_', { stopWhenCaughtUp: true });
    ui.alert('업로드 전체 동기화', r.done
      ? '완료. 신규 ' + r.added + '행 추가.\n\n' +
        '이어서 [악보집 일괄 등록] → [영상 매칭]을 실행하세요.\n' +
        '영상 매칭이 끝나면 [_빠진파트] 시트에 아직 비어 있는 곡·파트가 정리됩니다.'
      : '시간 제한으로 중단했습니다. 이번에 ' + r.added + '행 추가.\n\n' +
        '[업로드 전체 동기화]를 다시 누르면 중단한 지점부터 이어서 받습니다.\n' +
        '"완료"가 뜰 때까지 반복하세요.',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('업로드 동기화 실패', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

function uploadsPlaylist_(channelId) {
  var channel = YouTube.Channels.list('contentDetails', { id: channelId });
  var items = channel.items || [];
  if (!items.length || !items[0].contentDetails) return null;
  var id = items[0].contentDetails.relatedPlaylists.uploads;
  return id ? { id: id, title: UPLOADS_PLAYLIST_TITLE } : null;
}

var UPLOADS_PLAYLIST_TITLE = '(전체 업로드)';

/**
 * 재생목록들을 yt_cache에 복사한다. 채널 동기화와 업로드 전체 동기화가 함께 쓴다.
 * prefix는 이어하기 상태를 담는 스크립트 속성 이름의 앞머리다 — 둘이 서로의 중단 지점을 덮지 않게.
 *
 * 돌려주는 것: { done, added, index }
 */
function mirrorPlaylists_(ss, playlists, prefix, options) {
  // stopWhenCaughtUp: 업로드 목록은 최신순이다. 한 번 끝까지 받은 뒤에는, 한 쪽이 통째로
  // 이미 캐시에 있으면 그 뒤도 다 있는 것이므로 거기서 멈춘다. 주간 자동 점검이 몇 초로 끝난다.
  var caughtUpStops = !!(options && options.stopWhenCaughtUp);
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
  var sheet = getCacheSheet_(ss);

  // 중복 판정은 videoId 단독이 아니라 videoId+playlistId 조합으로 한다.
  // 같은 영상이 '중앙성가 41집'과 '음원 모음'에 모두 들어 있을 수 있는데,
  // videoId만으로 걸러내면 집 번호를 알려주는 쪽 행이 사라진다.
  var seen = loadSeenKeys_(sheet);
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  var added = 0;
  var startIndex = Number(props.getProperty(prefix + 'INDEX') || 0);
  if (!(startIndex >= 0) || startIndex >= playlists.length) startIndex = 0;

  // 중단 지점을 재생목록 인덱스뿐 아니라 페이지 토큰까지 남긴다.
  // 인덱스만 남기면 재개할 때마다 그 재생목록을 0쪽부터 다시 훑게 되는데,
  // 재생목록 하나의 페이지 수가 한 번의 실행 예산을 넘으면 영원히 끝에 닿지 못한다.
  // 토큰이 어느 재생목록의 것인지도 함께 확인한다 — 채널의 재생목록 순서가
  // 실행 사이에 바뀌면 엉뚱한 재생목록에 토큰을 쓰게 되기 때문이다.
  var startToken = props.getProperty(prefix + 'TOKEN') || null;
  if (props.getProperty(prefix + 'PLAYLIST_ID') !== (playlists[startIndex] || {}).id) {
    startToken = null;
  }

  function flush(rows) {
    if (!rows.length) return;
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CACHE_HEADERS.length).setValues(rows);
    added += rows.length;
    rows.length = 0;
  }

  var i = startIndex;
  var pendingToken = null;

  for (; i < playlists.length; i++) {
    if (Date.now() - t0 > MAX_RUNTIME_MS) { pendingToken = null; break; }

    var pl = playlists[i];
    var rows = [];
    var token = (i === startIndex) ? startToken : null;
    var exhausted = false;

    do {
      var res = YouTube.PlaylistItems.list('snippet', {
        playlistId: pl.id, maxResults: 50, pageToken: token
      });

      var newInPage = 0;
      (res.items || []).forEach(function (item) {
        var sn = item.snippet || {};
        var vid = sn.resourceId && sn.resourceId.videoId;
        if (!vid) return;
        // 삭제·비공개 영상은 제목이 자리표시자로 바뀌어 매칭에 쓸 수 없다.
        if (sn.title === 'Deleted video' || sn.title === 'Private video') return;

        var key = vid + '|' + pl.id;
        if (seen[key]) return;
        seen[key] = true;
        newInPage++;

        rows.push([
          vid,
          sn.title || '',
          pl.title,
          pl.id,
          typeof sn.position === 'number' ? sn.position + 1 : '',
          sn.publishedAt ? String(sn.publishedAt).slice(0, 10) : '',
          stamp
        ]);
      });

      // 업로드 목록은 수백 쪽이다. 중간에 예외가 나도 받은 만큼은 남도록 자주 쓴다.
      if (rows.length >= 1000) flush(rows);

      token = res.nextPageToken;
      if (!token) exhausted = true;
      if (caughtUpStops && !newInPage && props.getProperty(prefix + 'FULL_DONE')) {
        token = null;
        exhausted = true;
      }
    } while (token && Date.now() - t0 <= MAX_RUNTIME_MS);

    flush(rows);

    // 이 재생목록의 페이지가 남았는데 시간이 끊긴 경우.
    // i를 증가시키지 않고 빠져나와야 다음 실행이 이 재생목록을 이어받는다.
    // (i++ 뒤에 중단하면 남은 페이지를 영영 못 가져오고, 알림은 완료로 뜬다.)
    if (!exhausted) { pendingToken = token; break; }
  }

  if (i < playlists.length) {
    props.setProperty(prefix + 'INDEX', String(i));
    props.setProperty(prefix + 'PLAYLIST_ID', playlists[i].id);
    if (pendingToken) props.setProperty(prefix + 'TOKEN', pendingToken);
    else props.deleteProperty(prefix + 'TOKEN');
    return { done: false, added: added, index: i };
  }
  clearResumeState_(props, prefix);
  props.setProperty(prefix + 'FULL_DONE', '1');
  return { done: true, added: added, index: i };
}

function clearResumeState_(props, prefix) {
  var prefixes = prefix ? [prefix] : ['RESUME_', 'UPLOADS_RESUME_'];
  prefixes.forEach(function (p) {
    props.deleteProperty(p + 'INDEX');
    props.deleteProperty(p + 'TOKEN');
    props.deleteProperty(p + 'PLAYLIST_ID');
  });
}

/**
 * 핸들 → 채널 ID. 한 번 찾으면 스크립트 속성에 캐시한다.
 *
 * search.list는 쓰지 않는다. 호출당 100 units인 것도 있지만, 더 큰 이유는
 * 그 호출 하나가 youtube.readonly보다 넓은 승인 범위를 요구하기 때문이다
 * (youtube / youtube.force-ssl / youtubepartner 중 하나). 채널 ID 하나 찾자고
 * 채널 편집 권한까지 요구하는 것은 맞지 않는다. 못 찾으면 사람에게 물어본다.
 */
function resolveChannelId_(ss) {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('CHANNEL_ID');
  if (cached) return cached;

  // config에 채널 ID를 직접 넣어 두면 API를 아예 부르지 않는다.
  var configured = extractChannelId_(readConfigValue_(ss, '유튜브채널ID'));
  if (configured) {
    props.setProperty('CHANNEL_ID', configured);
    return configured;
  }

  var handle = normalizeHandle_(readConfigValue_(ss, '유튜브채널핸들')) || DEFAULT_CHANNEL_HANDLE;
  var reason = '';

  // 1순위: API의 핸들 조회.
  try {
    var byHandle = YouTube.Channels.list('id', { forHandle: handle });
    if (byHandle.items && byHandle.items.length) {
      var found = byHandle.items[0].id;
      props.setProperty('CHANNEL_ID', found);
      return found;
    }
    reason = '핸들 @' + handle + '로 채널을 찾지 못했습니다.';
  } catch (err) {
    // 실패 사유를 삼키지 않는다. 권한 문제인지 핸들 문제인지 여기서만 알 수 있다.
    reason = String(err && err.message ? err.message : err);
  }

  // 2순위: 채널 페이지의 HTML에서 직접 읽는다.
  // forHandle은 고급 서비스 버전에 따라 없을 수 있는데, 채널 ID는 페이지에 그대로 들어 있다.
  // API 할당량도 들지 않고, 사람이 소스를 뒤질 일도 없어진다.
  var scraped = channelIdFromPage_(handle);
  if (scraped) {
    props.setProperty('CHANNEL_ID', scraped);
    return scraped;
  }

  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt(
    '채널 ID 입력',
    '핸들 @' + handle + '로 채널을 찾지 못했습니다.\n' + reason + '\n\n' +
      '채널 ID(UC로 시작하는 24자)를 찾는 방법:\n' +
      '  1. 브라우저에서 youtube.com/@' + handle + ' 를 엽니다\n' +
      '  2. Ctrl+U (페이지 소스 보기)\n' +
      '  3. Ctrl+F 로 externalId 를 찾습니다\n' +
      '  4. 옆의 "UC..." 값을 복사해 아래에 붙여넣습니다\n\n' +
      'UC로 시작하는 값이 들어 있으면 주소를 통째로 붙여넣어도 됩니다.\n' +
      '한 번만 입력하면 저장되고, config의 유튜브채널ID에 넣어 두어도 됩니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (answer.getSelectedButton() !== ui.Button.OK) {
    throw new Error('채널 ID 입력을 취소했습니다.');
  }

  var raw = String(answer.getResponseText() || '').trim();
  var typed = extractChannelId_(raw);

  // 핸들이나 @주소를 넣었다면 그 핸들로 페이지를 다시 읽어 본다.
  if (!typed) {
    var typedHandle = normalizeHandle_(raw);
    if (typedHandle) typed = channelIdFromPage_(typedHandle);
  }

  if (!typed) {
    throw new Error('채널 ID를 알아보지 못했습니다. UC로 시작하는 24자를 넣어 주세요. 입력값: ' + raw);
  }

  props.setProperty('CHANNEL_ID', typed);
  return typed;
}

/**
 * 채널 페이지 HTML에서 채널 ID를 읽는다.
 *
 * 페이지 어디에나 있는 `UC…`를 아무거나 집으면 관련 채널의 것을 잡을 수 있으므로,
 * 그 채널 자신을 가리키는 자리만 순서대로 본다.
 */
function channelIdFromPage_(handle) {
  var patterns = [
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
    /channel_id=(UC[A-Za-z0-9_-]{22})/,
    /rel="canonical"[^>]*\/channel\/(UC[A-Za-z0-9_-]{22})/,
    /itemprop="identifier"[^>]*content="(UC[A-Za-z0-9_-]{22})"/
  ];

  try {
    var res = UrlFetchApp.fetch('https://www.youtube.com/@' + encodeURIComponent(handle), {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) return '';
    var html = res.getContentText();
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m) return m[1];
    }
  } catch (e) {
    // 네트워크 실패나 권한 부족. 아래에서 사람에게 묻는다.
  }
  return '';
}

/**
 * 핸들만 뽑는다. config에 `@JandAArt`나 채널 주소를 통째로 넣어도 되게 한다.
 * forHandle은 @가 붙어도 받지만, 주소를 통째로 넣으면 실패한다.
 */
function normalizeHandle_(value) {
  var v = String(value || '').trim();
  if (!v) return '';
  var fromUrl = v.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
  if (fromUrl) return fromUrl[1];
  return v.replace(/^@/, '');
}

/** 채널 ID만 뽑는다. 전체 주소를 붙여넣어도 되게 한다. */
function extractChannelId_(value) {
  var m = String(value || '').match(/UC[A-Za-z0-9_-]{22}/);
  return m ? m[0] : '';
}

function fetchAllPlaylists_(channelId) {
  var out = [];
  var token = null;

  do {
    var res = YouTube.Playlists.list('snippet', {
      channelId: channelId, maxResults: 50, pageToken: token
    });
    (res.items || []).forEach(function (p) {
      out.push({ id: p.id, title: (p.snippet && p.snippet.title) || '' });
    });
    token = res.nextPageToken;
  } while (token);

  // 업로드 목록(재생목록에 없는 영상까지)은 [업로드 전체 동기화]가 따로 받는다.

  return out;
}

/** yt_cache는 사람이 편집하지 않는다 (§4.7). 없으면 만들고 숨긴다. */
function getCacheSheet_(ss) {
  var sheet = ss.getSheetByName('yt_cache');
  if (!sheet) {
    sheet = ss.insertSheet('yt_cache');
    sheet.getRange(1, 1, 1, CACHE_HEADERS.length).setValues([CACHE_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

/**
 * yt_cache를 빠르게 읽는다.
 *
 * 공용 readSheet_는 셀마다 형식을 정규화하는데, 캐시는 1만 행이 넘어서
 * 7만 번의 셀 처리가 된다. 여기 값은 이미 문자열이고 필요한 열도 셋뿐이라
 * 한 번에 읽어 그대로 쓴다. 악보집 등록이 권마다 몇 초씩 걸리던 원인이었다.
 */
function readCacheRows_(ss) {
  var sheet = ss.getSheetByName('yt_cache');
  if (!sheet) return [];
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(1, 1, last, CACHE_HEADERS.length).getValues();
  var idx = {};
  for (var h = 0; h < values[0].length; h++) idx[String(values[0][h]).trim()] = h;

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var videoId = values[r][idx['videoId']];
    if (!videoId) continue;
    out.push({
      videoId: String(videoId),
      제목: String(values[r][idx['제목']] || ''),
      재생목록명: String(values[r][idx['재생목록명']] || '')
    });
  }
  return out;
}

/** 이미 캐시에 있는 videoId|playlistId 조합. */
function loadSeenKeys_(sheet) {
  var seen = {};
  var last = sheet.getLastRow();
  if (last < 2) return seen;

  var values = sheet.getRange(2, 1, last - 1, 4).getValues(); // videoId … playlistId
  for (var i = 0; i < values.length; i++) {
    if (values[i][0]) seen[values[i][0] + '|' + values[i][3]] = true;
  }
  return seen;
}

/**
 * 캐시 점검 — 메뉴: 성가 아카이브 > 캐시 점검
 *
 * "채널에 재생목록이 없다"는 말이 맞는지 확인한다. 동기화가 못 가져온 것인지,
 * 재생목록 이름이 규칙에 안 맞는 것인지는 캐시를 봐야 안다.
 */
function cacheReport() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet_();
  var rows = readCacheRows_(ss);
  if (!rows.length) {
    ui.alert('yt_cache가 비어 있습니다. 먼저 [채널 동기화]를 실행하세요.');
    return;
  }

  var byPlaylist = {};
  var order = [];
  var VOICE_PARTS = ['소프라노', '알토', '테너', '베이스'];
  var voiceByBook = {};
  for (var i = 0; i < rows.length; i++) {
    var name = rows[i]['재생목록명'] || '(이름 없음)';
    if (!byPlaylist[name]) {
      byPlaylist[name] = { count: 0, book: parsePlaylistBook_(name), parts: {}, noNumber: 0 };
      order.push(name);
    }
    var info = byPlaylist[name];
    info.count++;
    // 제목이 실제로 어떻게 읽히는지도 함께 센다. "추가했는데 왜 안 들어가지?"는
    // 여기서 답이 나와야 한다 — 영상 매칭은 집을 모르는 영상을 조용히 건너뛴다.
    var parsed = parseVideoTitle_(rows[i]['제목']);
    info.parts[parsed.part] = (info.parts[parsed.part] || 0) + 1;
    if (!parsed.number) info.noNumber++;
    // 권별 파트 수는 영상마다 센다. [전체 업로드] 목록은 이름에 집 번호가 없어,
    // 재생목록 단위로 세면 그 안의 파트 영상이 어느 권에도 잡히지 않는다.
    var entryBook = info.book || parsed.bookCode;
    if (entryBook) {
      if (voiceByBook[entryBook] === undefined) voiceByBook[entryBook] = 0;
      if (VOICE_PARTS.indexOf(parsed.part) !== -1) voiceByBook[entryBook]++;
    }
  }

  // 인식된 권 / 다른 시리즈 / 그 밖으로 나눈다.
  // "이름에 중앙성가 N집이 들어 있지만 다른 시리즈"를 따로 세워 두는 게 핵심이다.
  // 이게 없으면 "왜 중2로 안 잡히지?"를 재생목록 이름만 보고는 알 수 없다.
  var recognized = 0;
  var otherSeries = 0;
  var PART_COLUMNS = ['합창', '소프라노', '알토', '테너', '베이스', '반주'];
  var table = order.map(function (name) {
    var info = byPlaylist[name];
    var verdict;
    if (info.book) { verdict = '인식됨'; recognized++; }
    else if (/중앙성가\s*\d+\s*집/.test(name)) { verdict = '다른 시리즈 (본 중앙성가 아님)'; otherSeries++; }
    else verdict = '집 번호 없음';
    var row = [info.book || '', name, info.count, verdict];
    PART_COLUMNS.forEach(function (part) { row.push(info.parts[part] || 0); });
    row.push(info.noNumber);
    return row;
  });
  table.sort(function (a, b) {
    if (a[0] && b[0]) return bookNumber_(a[0]) - bookNumber_(b[0]) || a[1].localeCompare(b[1]);
    if (a[0]) return -1;
    if (b[0]) return 1;
    return a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]);
  });

  var headers = ['집코드', '재생목록명', '영상 수', '판정']
    .concat(PART_COLUMNS)
    .concat(['곡번호 없음']);
  var sheet = ss.getSheetByName('_재생목록') || ss.insertSheet('_재생목록');
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (table.length) sheet.getRange(2, 1, table.length, headers.length).setValues(table);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  // 보유 권 단위 요약. 재생목록이 아예 없는 권과, 목록은 있는데
  // 파트(소프라노~베이스) 영상이 하나도 없는 권을 나눠서 보여준다.
  // "40집을 추가했는데 왜 파트가 안 들어가지?"는 이 두 줄이 답이다.
  var missing = [];
  var voiceless = [];
  var books = readSheet_(ss, 'books', ss.getSpreadsheetTimeZone());
  for (var b = 0; b < books.length; b++) {
    var code = String(books[b]['집코드'] || '').trim();
    if (!code || !toBool_(books[b]['보유'])) continue;
    if (voiceByBook[code] === undefined) missing.push(code);
    else if (!voiceByBook[code]) voiceless.push(code);
  }

  ui.alert(
    '캐시 점검',
    '캐시 ' + rows.length + '행 · 재생목록 ' + table.length + '개\n' +
      '  인식됨 ' + recognized + '개 · 다른 시리즈 ' + otherSeries + '개 · 집 번호 없음 ' +
      (table.length - recognized - otherSeries) + '개\n\n' +
      '전체 목록을 [_재생목록] 시트에 적었습니다. 재생목록마다 파트 구성까지 나옵니다.\n\n' +
      (missing.length
        ? '재생목록이 없는 보유 권: ' + missing.join(', ') + '\n'
        : '') +
      (voiceless.length
        ? '재생목록은 있지만 파트(소프라노~베이스) 영상이 없는 보유 권: ' + voiceless.join(', ') + '\n'
        : '') +
      (missing.length || voiceless.length
        ? '유튜브에서 그 권의 전 파트 재생목록을 찾아 [재생목록 직접 추가]에 넣으세요.\n' +
          '넣었는데도 여기 남아 있다면, _재생목록 시트에서 그 목록의 이름과 판정을 확인하세요.'
        : '보유 권 모두 파트 영상까지 캐시에 있습니다.'),
    ui.ButtonSet.OK
  );
}

/** '중43' → 43. 정렬용. */
function bookNumber_(code) {
  var m = String(code || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 재생목록 직접 추가 — 메뉴: 성가 아카이브 > 재생목록 직접 추가
 *
 * playlists.list(channelId=…)는 채널이 **소유한 공개 재생목록**만 돌려준다.
 * 실제로 중앙성가 38집(PL430hIGWVSfKttjYeqChcDjAfQXJ1e0CY)처럼 유튜브에서
 * 멀쩡히 보이는 목록이 그 응답에 없었다. 다른 계정 소유이거나 미등록 목록이면
 * 채널 동기화로는 영영 안 들어온다. 그래서 주소를 직접 받는 길을 열어 둔다.
 *
 * 여러 개를 한 번에 받는다. 빠진 권이 다섯이면 다섯 번 누르게 할 이유가 없다.
 * 목록이 어느 채널 것인지도 함께 보여준다 — 채널 동기화가 왜 놓쳤는지가 거기서 드러난다.
 */
function addPlaylistPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    '재생목록 직접 추가',
    '유튜브 재생목록 주소나 ID를 붙여넣으세요. 여러 개면 띄어쓰기로 나눠 한 줄에 넣으세요.\n' +
      '(이 입력창은 한 줄짜리라, 여러 줄을 붙여넣으면 첫 줄만 들어올 수 있습니다.\n' +
      ' watch?v=…&list=PL… 형태의 주소도 됩니다)',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var ids = [];
  var seenId = {};
  var matches = String(res.getResponseText() || '').match(/PL[A-Za-z0-9_-]{10,}/g) || [];
  for (var i = 0; i < matches.length; i++) {
    if (!seenId[matches[i]]) { seenId[matches[i]] = true; ids.push(matches[i]); }
  }
  if (!ids.length) {
    ui.alert('재생목록 ID를 알아보지 못했습니다. PL로 시작하는 값이 있어야 합니다.');
    return;
  }

  var ss = getSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
  var sheet = getCacheSheet_(ss);
  var seen = loadSeenKeys_(sheet);
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  var lines = [];
  for (var p = 0; p < ids.length; p++) {
    lines.push(addOnePlaylist_(ids[p], sheet, seen, stamp));
  }

  ui.alert(
    '재생목록 추가 완료',
    '입력에서 재생목록 ' + ids.length + '개를 알아봤습니다.\n' +
      '(붙여넣은 주소 수와 다르면 입력창에서 잘린 것입니다 — 남은 것을 다시 넣으세요.)\n\n' +
      lines.join('\n\n') +
      '\n\n이어서 [악보집 일괄 등록] → [영상 매칭]을 실행하세요.',
    ui.ButtonSet.OK
  );
}

/** 재생목록 하나를 캐시에 넣고, 사람이 읽을 결과 한 덩이를 돌려준다. */
function addOnePlaylist_(playlistId, sheet, seen, stamp) {
  try {
    var meta = YouTube.Playlists.list('snippet', { id: playlistId });
    if (!meta.items || !meta.items.length) {
      return playlistId + '\n  ✗ 찾을 수 없습니다 (비공개이거나 삭제된 목록).';
    }
    var snippet = meta.items[0].snippet || {};
    var title = snippet.title || '(제목 없음)';
    var owner = snippet.channelTitle || '(채널 불명)';

    var rows = [];
    var token = null;
    do {
      var page = YouTube.PlaylistItems.list('snippet', {
        playlistId: playlistId, maxResults: 50, pageToken: token
      });
      (page.items || []).forEach(function (item) {
        var sn = item.snippet || {};
        var vid = sn.resourceId && sn.resourceId.videoId;
        if (!vid) return;
        if (sn.title === 'Deleted video' || sn.title === 'Private video') return;
        if (seen[vid + '|' + playlistId]) return;
        seen[vid + '|' + playlistId] = true;
        rows.push([vid, sn.title || '', title, playlistId,
          typeof sn.position === 'number' ? sn.position + 1 : '',
          sn.publishedAt ? String(sn.publishedAt).slice(0, 10) : '', stamp]);
      });
      token = page.nextPageToken || '';
    } while (token);

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CACHE_HEADERS.length).setValues(rows);
    }

    // 방금 넣은 제목들이 실제로 어떻게 읽히는지 그 자리에서 보여준다.
    // "추가는 됐는데 매칭이 안 되는" 상태를 다음 단계까지 끌고 가지 않기 위해서다.
    var book = parsePlaylistBook_(title);
    var parts = {};
    var noNumber = 0;
    var bookless = 0;
    rows.forEach(function (r) {
      var parsed = parseVideoTitle_(r[1]);
      parts[parsed.part] = (parts[parsed.part] || 0) + 1;
      if (!parsed.number) noNumber++;
      if (!book && !parsed.bookCode) bookless++;
    });
    var partSummary = Object.keys(parts)
      .map(function (part) { return part + ' ' + parts[part]; })
      .join(' · ');

    return '"' + title + '"  (채널: ' + owner + ')\n' +
      (rows.length
        ? '  신규 ' + rows.length + '행 추가' + (partSummary ? ' — ' + partSummary : '') + '.\n' +
          (noNumber ? '  곡번호를 못 읽은 영상 ' + noNumber + '개 (매칭에서 제목으로 대조).\n' : '')
        : '  신규 0행 — 이 목록은 이미 전부 캐시에 들어 있습니다.\n') +
      (book
        ? '  ' + book + '으로 인식됩니다.'
        : bookless
          ? '  ⚠ 재생목록 이름에서도, 영상 제목 ' + bookless + '개에서도 집 번호를 읽지 못했습니다.\n' +
            '     이 영상들은 매칭에서 제외됩니다.'
          : '  재생목록 이름에는 집 번호가 없지만 영상 제목으로 인식됩니다.');
  } catch (err) {
    return playlistId + '\n  ✗ ' + String(err && err.message ? err.message : err);
  }
}

/**
 * 제목 형식 확인 (§11 미결정 항목).
 * 매칭 규칙을 정하기 전에 실제 영상 제목이 어떤 모양인지 눈으로 보기 위한 것.
 */
function sampleTitles() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getCacheSheet_(getSpreadsheet_());
  var last = sheet.getLastRow();
  if (last < 2) {
    ui.alert('yt_cache가 비어 있습니다. 먼저 [채널 동기화]를 실행하세요.');
    return;
  }

  var values = sheet.getRange(2, 1, last - 1, 3).getValues(); // videoId, 제목, 재생목록명
  var step = Math.max(1, Math.floor(values.length / 25));
  var lines = [];
  for (var i = 0; i < values.length && lines.length < 25; i += step) {
    lines.push('[' + values[i][2] + ']  ' + values[i][1]);
  }

  Logger.log('yt_cache 총 ' + values.length + '행\n\n' + lines.join('\n'));
  ui.alert(
    '제목 형식 확인',
    '총 ' + values.length + '행.\n\n' + lines.slice(0, 15).join('\n') +
      '\n\n(전체 샘플은 [실행 로그]에서 확인)\n\n' +
      '이 형식에 맞춰 parseVideoTitle_ 규칙을 고친 뒤 [영상 매칭]을 다시 실행하면 됩니다. ' +
      '재매칭은 API 할당량을 쓰지 않습니다.',
    ui.ButtonSet.OK
  );
}

/** 캐시를 비운다. 매칭 규칙이 아니라 캐시 자체를 다시 받고 싶을 때만 쓴다. */
function clearCache() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('yt_cache를 전부 비울까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  var sheet = getCacheSheet_(getSpreadsheet_());
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, CACHE_HEADERS.length).clearContent();
  }
  var props = PropertiesService.getScriptProperties();
  clearResumeState_(props);
  // 캐시가 비었으니 "끝까지 받은 적 있음"도 잊는다. 안 그러면 업로드 동기화가 첫 쪽에서 멈출 수 있다.
  props.deleteProperty('RESUME_FULL_DONE');
  props.deleteProperty('UPLOADS_RESUME_FULL_DONE');
  ui.alert('비웠습니다.');
}

function readConfigValue_(ss, key) {
  var sheet = ss.getSheetByName('config');
  if (!sheet || sheet.getLastRow() < 2) return '';
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) return String(rows[i][1]).trim();
  }
  return '';
}
