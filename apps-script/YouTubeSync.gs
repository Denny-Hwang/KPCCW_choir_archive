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

/** 재생목록에 들어가지 않은 영상까지 훑을지. 켜면 행이 크게 늘어난다. */
var INCLUDE_UPLOADS = false;

var CACHE_HEADERS = ['videoId', '제목', '재생목록명', 'playlistId',
                     '재생목록내순서', '게시일', '수집일시'];

/**
 * [1단계] 채널 미러링 — 메뉴: 성가 아카이브 > 채널 동기화
 *
 * 시간 제한에 걸리면 RESUME_INDEX를 남기고 중단한다. 다시 실행하면 이어서 진행한다.
 */
function syncChannel() {
  var ui = SpreadsheetApp.getUi();
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();

  try {
    var ss = getSpreadsheet_();
    var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
    var sheet = getCacheSheet_(ss);
    var channelId = resolveChannelId_(ss);
    var playlists = fetchAllPlaylists_(channelId);

    // 중복 판정은 videoId 단독이 아니라 videoId+playlistId 조합으로 한다.
    // 같은 영상이 '중앙성가 41집'과 '음원 모음'에 모두 들어 있을 수 있는데,
    // videoId만으로 걸러내면 집 번호를 알려주는 쪽 행이 사라진다.
    var seen = loadSeenKeys_(sheet);
    var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

    var added = 0;
    var startIndex = Number(props.getProperty('RESUME_INDEX') || 0);
    if (!(startIndex >= 0) || startIndex >= playlists.length) startIndex = 0;

    // 중단 지점을 재생목록 인덱스뿐 아니라 페이지 토큰까지 남긴다.
    // 인덱스만 남기면 재개할 때마다 그 재생목록을 0쪽부터 다시 훑게 되는데,
    // 재생목록 하나의 페이지 수가 한 번의 실행 예산을 넘으면 영원히 끝에 닿지 못한다.
    // 토큰이 어느 재생목록의 것인지도 함께 확인한다 — 채널의 재생목록 순서가
    // 실행 사이에 바뀌면 엉뚱한 재생목록에 토큰을 쓰게 되기 때문이다.
    var startToken = props.getProperty('RESUME_TOKEN') || null;
    if (props.getProperty('RESUME_PLAYLIST_ID') !== (playlists[startIndex] || {}).id) {
      startToken = null;
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

        (res.items || []).forEach(function (item) {
          var sn = item.snippet || {};
          var vid = sn.resourceId && sn.resourceId.videoId;
          if (!vid) return;
          // 삭제·비공개 영상은 제목이 자리표시자로 바뀌어 매칭에 쓸 수 없다.
          if (sn.title === 'Deleted video' || sn.title === 'Private video') return;

          var key = vid + '|' + pl.id;
          if (seen[key]) return;
          seen[key] = true;

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

        token = res.nextPageToken;
        if (!token) exhausted = true;
      } while (token && Date.now() - t0 <= MAX_RUNTIME_MS);

      if (rows.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CACHE_HEADERS.length).setValues(rows);
        added += rows.length;
      }

      // 이 재생목록의 페이지가 남았는데 시간이 끊긴 경우.
      // i를 증가시키지 않고 빠져나와야 다음 실행이 이 재생목록을 이어받는다.
      // (i++ 뒤에 중단하면 남은 페이지를 영영 못 가져오고, 알림은 완료로 뜬다.)
      if (!exhausted) { pendingToken = token; break; }
    }

    var message;
    if (i < playlists.length) {
      props.setProperty('RESUME_INDEX', String(i));
      props.setProperty('RESUME_PLAYLIST_ID', playlists[i].id);
      if (pendingToken) props.setProperty('RESUME_TOKEN', pendingToken);
      else props.deleteProperty('RESUME_TOKEN');
      message = '시간 제한으로 중단했습니다.\n\n' +
        '재생목록 ' + i + '/' + playlists.length + ' 완료, 신규 ' + added + '행 추가.\n' +
        '[채널 동기화]를 다시 실행하면 중단한 지점부터 이어서 진행합니다.';
    } else {
      clearResumeState_(props);
      message = '완료.\n\n재생목록 ' + playlists.length + '개, 신규 ' + added + '행 추가.\n\n' +
        '이어서 [제목 형식 확인]으로 영상 제목 형식을 눈으로 확인한 뒤 [영상 매칭]을 실행하세요.';
    }
    ui.alert('채널 동기화', message, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('동기화 실패', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

function clearResumeState_(props) {
  props.deleteProperty('RESUME_INDEX');
  props.deleteProperty('RESUME_TOKEN');
  props.deleteProperty('RESUME_PLAYLIST_ID');
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

  if (INCLUDE_UPLOADS) {
    var channel = YouTube.Channels.list('contentDetails', { id: channelId });
    var items = channel.items || [];
    if (items.length && items[0].contentDetails) {
      out.push({ id: items[0].contentDetails.relatedPlaylists.uploads, title: '(전체 업로드)' });
    }
  }

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
  for (var i = 0; i < rows.length; i++) {
    var name = rows[i]['재생목록명'] || '(이름 없음)';
    if (!byPlaylist[name]) {
      byPlaylist[name] = { count: 0, book: parsePlaylistBook_(name) };
      order.push(name);
    }
    byPlaylist[name].count++;
  }

  // 인식된 권 / 다른 시리즈 / 그 밖으로 나눈다.
  // "이름에 중앙성가 N집이 들어 있지만 다른 시리즈"를 따로 세워 두는 게 핵심이다.
  // 이게 없으면 "왜 중2로 안 잡히지?"를 재생목록 이름만 보고는 알 수 없다.
  var recognized = 0;
  var otherSeries = 0;
  var table = order.map(function (name) {
    var info = byPlaylist[name];
    var verdict;
    if (info.book) { verdict = '인식됨'; recognized++; }
    else if (/중앙성가\s*\d+\s*집/.test(name)) { verdict = '다른 시리즈 (본 중앙성가 아님)'; otherSeries++; }
    else verdict = '집 번호 없음';
    return [info.book || '', name, info.count, verdict];
  });
  table.sort(function (a, b) {
    if (a[0] && b[0]) return bookNumber_(a[0]) - bookNumber_(b[0]) || a[1].localeCompare(b[1]);
    if (a[0]) return -1;
    if (b[0]) return 1;
    return a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]);
  });

  var sheet = ss.getSheetByName('_재생목록') || ss.insertSheet('_재생목록');
  sheet.clear();
  sheet.getRange(1, 1, 1, 4).setValues([['집코드', '재생목록명', '영상 수', '판정']]).setFontWeight('bold');
  if (table.length) sheet.getRange(2, 1, table.length, 4).setValues(table);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 4);

  // 보유 권 가운데 캐시에 재생목록이 없는 것.
  var have = {};
  table.forEach(function (r) { if (r[0]) have[r[0]] = true; });
  var missing = [];
  var books = readSheet_(ss, 'books', ss.getSpreadsheetTimeZone());
  for (var b = 0; b < books.length; b++) {
    var code = String(books[b]['집코드'] || '').trim();
    if (code && toBool_(books[b]['보유']) && !have[code]) missing.push(code);
  }

  ui.alert(
    '캐시 점검',
    '캐시 ' + rows.length + '행 · 재생목록 ' + table.length + '개\n' +
      '  인식됨 ' + recognized + '개 · 다른 시리즈 ' + otherSeries + '개 · 집 번호 없음 ' +
      (table.length - recognized - otherSeries) + '개\n\n' +
      '전체 목록을 [_재생목록] 시트에 적었습니다. 거기서 찾으시는 권을 확인하세요.\n\n' +
      (missing.length
        ? '보유 권 중 캐시에 재생목록이 없는 것: ' + missing.join(', ') + '\n' +
          '_재생목록 시트에서 이름이 다른 목록으로 들어 있지 않은지 보고,\n' +
          '없으면 [재생목록 직접 추가]로 주소를 넣으세요.'
        : '보유 권은 모두 재생목록을 찾았습니다.'),
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
    '유튜브 재생목록 주소나 ID를 붙여넣으세요. 여러 개면 줄바꿈으로 나눠 넣으면 됩니다.\n' +
      '(watch?v=…&list=PL… 형태의 주소도 됩니다)',
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
    lines.join('\n\n') + '\n\n이어서 [악보집 일괄 등록] → [영상 매칭]을 실행하세요.',
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

    var book = parsePlaylistBook_(title);
    return '"' + title + '"  (채널: ' + owner + ')\n' +
      '  신규 ' + rows.length + '행 추가.\n' +
      (book
        ? '  ' + book + '으로 인식됩니다.'
        : '  ⚠ 이 이름에서는 집 번호를 읽을 수 없습니다. 영상 제목에 "중앙성가 NN집"이\n' +
          '     들어 있으면 그것으로 인식되고, 아니면 매칭되지 않습니다.');
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
  clearResumeState_(PropertiesService.getScriptProperties());
  ui.alert('비웠습니다.');
}

function matchVideos() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();

  var cache = readCacheRows_(ss);
  if (!cache.length) {
    ui.alert('yt_cache가 비어 있습니다. 먼저 "채널 동기화"를 실행하세요.');
    return;
  }

  var songs = readSheet_(ss, 'songs', tz);
  var byCode = {};
  var byBookAndTitle = {};
  for (var s = 0; s < songs.length; s++) {
    var song = songs[s];
    var code = String(song['곡코드'] || '').trim();
    var display = String(song['표시명'] || '').trim();
    if (!display) continue;
    if (code) byCode[code] = display;
    var bookCode = String(song['집코드'] || '').trim();
    if (bookCode) byBookAndTitle[bookCode + '|' + normalizeTitle_(song['제목'])] = display;
  }

  var links = readSheet_(ss, 'practice_links', tz);
  var seen = {};
  for (var l = 0; l < links.length; l++) {
    seen[String(links[l]['표시명']) + '|' + String(links[l]['파트'])] = true;
  }

  // 후보를 먼저 모은 뒤, 같은 (곡, 파트)에서 실연을 MIDI보다 우선한다.
  // 41집 이후는 같은 곡이 두 벌로 올라오는데, 연습에는 실연 녹음이 낫다.
  var candidates = {};
  var failures = [];
  var midiOnly = 0;

  for (var c = 0; c < cache.length; c++) {
    var entry = cache[c];
    var parsed = parseVideoTitle_(entry['제목']);
    // 재생목록명이 1순위, 제목 안의 집 이름이 2순위.
    var bookCode = parsePlaylistBook_(entry['재생목록명']) || parsed.bookCode;

    if (!bookCode) continue; // 중앙성가 집이 아닌 영상. 실패로 세지 않는다.

    var display = null;
    if (parsed.number) display = byCode[bookCode + '-' + padNumber_(parsed.number)] || null;
    if (!display && parsed.title) display = byBookAndTitle[bookCode + '|' + normalizeTitle_(parsed.title)] || null;

    if (!display) {
      failures.push(entry['재생목록명'] + ' / ' + entry['제목']);
      continue;
    }

    var key = display + '|' + parsed.part;
    if (seen[key]) continue; // 이미 시트에 있는 조합은 건드리지 않는다 (§9.3 append only).

    var prev = candidates[key];
    if (!prev || (prev.isMidi && !parsed.isMidi)) {
      candidates[key] = { display: display, part: parsed.part, videoId: entry['videoId'], isMidi: parsed.isMidi };
    }
  }

  var linkSheet = ss.getSheetByName('practice_links');
  var linkHeaders = linkSheet.getRange(1, 1, 1, linkSheet.getLastColumn()).getValues()[0];

  var toAppend = [];
  for (var k in candidates) {
    var v = candidates[k];
    if (v.isMidi) midiOnly++;
    toAppend.push(buildLinkRow_(linkHeaders, v));
  }

  // 드롭다운에 걸리는 값이 하나라도 있으면 setValues가 묶음 전체를 예외로 죽인다.
  // 먼저 걸러 내야 나머지가 들어가고, 무엇이 걸렸는지도 알 수 있다.
  var split = splitByValidation_(linkSheet, linkHeaders, toAppend);
  if (split.ok.length) {
    linkSheet
      .getRange(linkSheet.getLastRow() + 1, 1, split.ok.length, linkHeaders.length)
      .setValues(split.ok);
  }

  var report = split.bad.map(function (b) { return '시트가 거부함 / ' + b.reason; });
  writeReport_(ss, report.concat(failures));

  ui.alert(
    '영상 매칭 완료',
    '추가 ' + split.ok.length + '개 (전부 검증 대기)\n' +
      (midiOnly ? '그중 ' + midiOnly + '개는 실연이 없어 MIDI를 썼습니다.\n' : '') +
      '매칭 실패 ' + failures.length + '건\n' +
      (split.bad.length ? '시트가 거부한 행 ' + split.bad.length + '개 — ' + split.bad[0].reason + '\n' : '') +
      '\n' +
      (report.length + failures.length ? '_매칭실패 시트에 목록을 적었습니다.\n' : '') +
      '추가된 링크는 사람이 재생을 확인해 검증 열을 체크하기 전까지 공지에 나가지 않습니다.',
    ui.ButtonSet.OK
  );
}

/** practice_links 행을 열 이름으로 만든다. 열 순서에 기대지 않는다 (§4.5). */
function buildLinkRow_(headers, candidate) {
  return headers.map(function (header) {
    switch (String(header).trim()) {
      case '표시명': return candidate.display;
      case '파트': return candidate.part;
      case 'URL': return 'https://youtu.be/' + candidate.videoId;
      case '출처': return 'youtube_channel';
      case '검증': return false;
      default: return '';
    }
  });
}

/**
 * 재생목록명 → 집코드.
 *
 * 실제 이름은 "[중앙아트] 중앙성가 52집", "[합창 듣기] 중앙성가 40집"처럼 앞머리 태그가 다양하다.
 * 태그는 걷어내되, 같은 채널에 이름 안에 "중앙성가 N집"을 품은 **다른 시리즈**가 함께 있다.
 *
 *   남성찬양대를 위한 중앙성가 2집 / 여성찬양대를 위한 중앙성가 2집 / 어린이 중앙성가 2집
 *
 * 이 셋을 전부 중2로 읽으면 서로 다른 세 권의 곡이 한 권에 섞인다(실제로 중3은 네 갈래였다).
 * 그래서 대괄호 태그를 걷어낸 뒤 "중앙성가" 앞에 글자가 남으면 다른 시리즈로 본다.
 * 뒤에 붙는 말("(구)", "- " 같은 것)은 같은 권의 다른 판이므로 그대로 받는다.
 */
function parsePlaylistBook_(playlistName) {
  var name = String(playlistName || '').replace(/\[[^\]]*\]/g, ' ');
  var m = name.match(/중앙성가\s*(\d+)\s*집/);
  if (!m) return null;
  if (bookQualifier_(name.slice(0, m.index))) return null;
  return '중' + parseInt(m[1], 10);
}

/**
 * "중앙성가" 앞에 남은 수식어. 공백·따옴표·구분자만 남으면 수식어가 없는 것이다.
 * 값이 있으면 본 시리즈가 아니라는 뜻이다.
 */
function bookQualifier_(head) {
  return String(head || '')
    .replace(/[\s'"\u2018\u2019\u201C\u201D()\[\]|\uFF5C\u00B7\u30FB\-\u2013\u2014_:,]/g, '')
    .trim();
}

var PART_PATTERNS = [
  [/소프라노|sop(rano)?/i, '소프라노'],
  [/알토|alto/i, '알토'],
  [/테너|tenor/i, '테너'],
  [/베이스|바리톤|bass|baritone/i, '베이스'],
  [/반주|피아노|accomp|\bMR\b/i, '반주'],
  [/합창|전곡|전체|full|tutti/i, '합창']
];

function matchPart_(text) {
  for (var i = 0; i < PART_PATTERNS.length; i++) {
    if (PART_PATTERNS[i][0].test(text)) return PART_PATTERNS[i][1];
  }
  return null;
}

/**
 * 영상 제목에서 곡번호·곡명·파트를 뽑는다. 실제 채널의 형식은 이렇다.
 *
 *   [중앙아트] 중앙성가 52집｜31. 하나님은 영이시니 (입례송) – 소프라노
 *   [중앙아트] 중앙성가 40집 32. 기도송 - 합창
 *   [중앙아트] ‘하나님의 시선 9집’ 13. 어버이의 사랑 – 소프라노 MIDI
 *
 * 집 이름과 곡번호 사이 구분자가 전각 ｜이기도 하고 공백이기도 하며,
 * 집 이름이 따옴표에 싸이기도 한다. 곡명에는 괄호와 &가 들어간다.
 * 41집 이후는 같은 곡이 MIDI와 실연 두 벌로 올라오므로 구분해 둔다.
 */
function parseVideoTitle_(rawTitle) {
  var cleaned = String(rawTitle || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

  var isMidi = /\bMIDI\b/i.test(cleaned);
  cleaned = cleaned.replace(/\bMIDI\b/gi, '').replace(/\s+/g, ' ').trim();

  // 집 번호는 뒤에 '집'이 붙으므로, 점이 따라오는 첫 숫자가 곡번호다.
  var numMatch = cleaned.match(/(\d{1,3})\s*\.\s*(.+)$/);
  var number = numMatch ? parseInt(numMatch[1], 10) : null;
  var rest = numMatch ? numMatch[2].trim() : cleaned;

  // 파트는 맨 뒤 구분자 뒤에 온다. 뒤쪽이 실제 파트 이름일 때만 잘라낸다.
  // (곡명 자체에 하이픈이 들어가도 잘리지 않게 하기 위해서다.)
  var part = null;
  var title = rest;
  var sep = rest.match(/^(.*?)\s*[–—\-|｜]\s*([^–—\-|｜]{1,24})\s*$/);
  if (sep) {
    var mapped = matchPart_(sep[2]);
    if (mapped) {
      part = mapped;
      title = sep[1].trim();
    }
  }
  if (!part) part = matchPart_(rest) || '합창';

  // 제목 안에도 집 이름이 들어 있다. 재생목록명이 애매할 때 쓴다.
  var head = numMatch ? cleaned.slice(0, numMatch.index) : '';

  return {
    number: number,
    title: title.replace(/^[\u2018\u2019\u201C\u201D'"]+|[\u2018\u2019\u201C\u201D'"]+$/g, '').trim(),
    part: part,
    isMidi: isMidi,
    bookCode: parsePlaylistBook_(head)
  };
}

/** 제목 정규화 (§9.4). 매칭 전 양쪽에 동일하게 적용한다. */
function normalizeTitle_(value) {
  return String(value || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    // 전각 영숫자를 반각으로.
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); })
    .replace(/[\s·・\-—–_'"'''""!?,.]/g, '')
    .replace(/^0+/, '')
    .toLowerCase();
}

function padNumber_(n) {
  return n < 10 ? '0' + n : String(n);
}

function writeReport_(ss, failures) {
  var sheet = ss.getSheetByName('_매칭실패') || ss.insertSheet('_매칭실패');
  sheet.clear();
  sheet.getRange(1, 1, 1, 1).setValues([['매칭하지 못한 영상 (재생목록명 / 제목)']]).setFontWeight('bold');
  if (failures.length) {
    sheet.getRange(2, 1, failures.length, 1).setValues(failures.map(function (f) { return [f]; }));
  }
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

/**
 * 보유 악보집 일괄 등록 — 메뉴: 성가 아카이브 > 악보집 일괄 등록
 *
 * 권마다 따로 누르면 그때마다 캐시 1만여 행을 다시 읽고, 채널에 없는 권에서는
 * 목차 붙여넣기 대화상자가 떠서 흐름이 끊긴다. 캐시를 한 번만 읽고
 * books의 보유 권을 전부 처리한 뒤, 채널에 없던 권을 모아서 알려준다.
 */
function registerOwnedBooks() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet_();
  var books = readSheet_(ss, 'books', ss.getSpreadsheetTimeZone());

  var owned = [];
  for (var b = 0; b < books.length; b++) {
    var code = String(books[b]['집코드'] || '').trim();
    if (code && toBool_(books[b]['보유'])) owned.push(code);
  }
  if (!owned.length) {
    ui.alert('books 시트에 보유(TRUE)로 표시된 악보집이 없습니다.');
    return;
  }

  var cache = readCacheRows_(ss);
  if (!cache.length) {
    ui.alert('yt_cache가 비어 있습니다. 먼저 [채널 동기화]를 실행하세요.');
    return;
  }

  var added = [];
  var missing = [];
  var rejected = [];
  for (var i = 0; i < owned.length; i++) {
    var entries = songsFromCache_(cache, owned[i]);
    if (!entries.length) {
      missing.push(owned[i]);
      continue;
    }
    var n = appendSongs_(ss, owned[i], entries, rejected);
    added.push(owned[i] + ' ' + n + '곡' + (n < entries.length ? ' (이미 있던 ' + (entries.length - n) + '곡 제외)' : ''));
  }

  ui.alert(
    '악보집 일괄 등록 완료',
    (added.length ? '추가됨\n  ' + added.join('\n  ') + '\n\n' : '새로 추가된 곡이 없습니다.\n\n') +
      (missing.length
        ? '채널에 재생목록이 없는 권: ' + missing.join(', ') + '\n' +
          '이 권들은 [악보집 등록]으로 목차를 붙여넣거나, 선곡할 때마다 한 곡씩 넣으면 됩니다.\n\n'
        : '') +
      (rejected.length
        ? '시트가 거부한 행 ' + rejected.length + '개:\n  ' + rejected.slice(0, 5).join('\n  ') + '\n' +
          '해당 열의 드롭다운 목록에 그 값이 없습니다. [시트 초기화]를 다시 실행하면 목록이 갱신됩니다.\n\n'
        : '') +
      '전부 상태=후보, 검증=FALSE로 들어갔습니다.\n' +
      '이어서 [영상 매칭]을 실행하면 파트 영상이 채워집니다.',
    ui.ButtonSet.OK
  );
}

/**
 * 신규 악보집 등록 (§9.4).
 * 채널 재생목록에서 수록곡을 찾고, 없으면 목차 붙여넣기로 폴백한다.
 */
function registerBookPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('악보집 등록', '중앙성가 권 번호를 입력하세요 (예: 50)', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var volume = parseInt(response.getResponseText(), 10);
  if (!volume || volume < 1) {
    ui.alert('권 번호를 숫자로 입력해 주세요.');
    return;
  }

  var ss = getSpreadsheet_();
  var bookCode = '중' + volume;
  ensureBookRow_(ss, bookCode, volume);

  var entries = songsFromCache_(readCacheRows_(ss), bookCode);
  if (!entries.length) {
    var pasted = ui.prompt(
      '수록곡 목록',
      bookCode + '의 재생목록을 캐시에서 찾지 못했습니다.\n' +
        '목차를 붙여넣으세요. 한 줄에 "번호<탭>곡명" 또는 "번호. 곡명" 형식 모두 됩니다.',
      ui.ButtonSet.OK_CANCEL
    );
    if (pasted.getSelectedButton() !== ui.Button.OK) return;
    entries = parsePastedToc_(pasted.getResponseText());
  }

  var rejected = [];
  var added = appendSongs_(ss, bookCode, entries, rejected);
  ui.alert(
    '악보집 등록 완료',
    bookCode + ' · ' + added + '곡 추가 (전부 상태=후보, 검증=FALSE)\n\n' +
      (rejected.length
        ? '시트가 거부한 행 ' + rejected.length + '개:\n  ' + rejected.slice(0, 5).join('\n  ') + '\n' +
          '해당 열의 드롭다운 목록에 그 값이 없습니다. [시트 초기화]를 다시 실행하면 목록이 갱신됩니다.\n\n'
        : '') +
      '이어서 "영상 매칭"을 실행하면 파트 영상이 검증 대기 상태로 채워집니다.',
    ui.ButtonSet.OK
  );
}

function ensureBookRow_(ss, bookCode, volume) {
  var sheet = ss.getSheetByName('books');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (sheet.getLastRow() > 1) {
    var codes = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0]).trim() === bookCode) return;
    }
  }
  var row = headers.map(function (header) {
    switch (String(header).trim()) {
      case '집코드': return bookCode;
      case '시리즈': return '중앙성가';
      case '권': return volume;
      case '출판사': return '중앙아트';
      case '성부': return 'SATB';
      case '보유': return true;
      default: return '';
    }
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function songsFromCache_(cache, bookCode) {
  var found = {};
  for (var i = 0; i < cache.length; i++) {
    var parsed = parseVideoTitle_(cache[i]['제목']);
    // 재생목록명이 1순위, 제목 안의 집 이름이 2순위.
    var entryBook = parsePlaylistBook_(cache[i]['재생목록명']) || parsed.bookCode;
    if (entryBook !== bookCode) continue;
    if (!parsed.number || !parsed.title) continue;
    if (!found[parsed.number]) found[parsed.number] = parsed.title;
  }
  return Object.keys(found)
    .map(function (n) { return { number: parseInt(n, 10), title: found[n] }; })
    .sort(function (a, b) { return a.number - b.number; });
}

function parsePastedToc_(text) {
  var out = [];
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = line.match(/^(\d{1,3})\s*(?:[.\t)\-]|\s)\s*(.+)$/);
    if (!m) continue;
    var title = m[2].trim();
    if (title) out.push({ number: parseInt(m[1], 10), title: title });
  }
  return out;
}

function appendSongs_(ss, bookCode, entries, rejected) {
  if (!entries.length) return 0;
  var sheet = ss.getSheetByName('songs');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var existing = {};
  var codeCol = columnIndex_(sheet, '곡코드');
  if (codeCol && sheet.getLastRow() > 1) {
    var codes = sheet.getRange(2, codeCol, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) existing[String(codes[i][0]).trim()] = true;
  }

  // 곡코드·표시명은 songs 시트의 ARRAYFORMULA가 채운다. 그 열에 값을 쓰면
  // (빈 문자열이라도) 배열 수식이 #REF!로 깨지므로, 그 두 열은 건드리지 않는다.
  var FORMULA_COLUMNS = { '곡코드': true, '표시명': true };

  var rows = [];
  for (var e = 0; e < entries.length; e++) {
    var code = bookCode + '-' + padNumber_(entries[e].number);
    if (existing[code]) continue; // 중복은 곡코드로 skip (§9.3).
    existing[code] = true;
    rows.push(buildSongRow_(headers, bookCode, entries[e], FORMULA_COLUMNS));
  }

  if (!rows.length) return 0;

  // 드롭다운이 걸린 열(집코드·상태·절기·출처)에 허용 밖의 값이 하나라도 있으면
  // setValues가 묶음 전체를 죽인다. 먼저 걸러 내고 무엇이 걸렸는지 남긴다.
  var split = splitByValidation_(sheet, headers, rows);
  if (rejected) {
    split.bad.forEach(function (b) { rejected.push(bookCode + ' — ' + b.reason); });
  }
  rows = split.ok;
  if (!rows.length) return 0;

  var startRow = sheet.getLastRow() + 1;
  // 수식 열을 건너뛰고 연속 구간 단위로만 쓴다.
  var segmentStart = -1;
  for (var c = 0; c <= headers.length; c++) {
    var isFormula = c === headers.length || FORMULA_COLUMNS[String(headers[c]).trim()];
    if (!isFormula && segmentStart === -1) {
      segmentStart = c;
    } else if (isFormula && segmentStart !== -1) {
      var width = c - segmentStart;
      var slice = rows.map(function (row) { return row.slice(segmentStart, c); });
      sheet.getRange(startRow, segmentStart + 1, rows.length, width).setValues(slice);
      segmentStart = -1;
    }
  }

  return rows.length;
}

function buildSongRow_(headers, bookCode, entry, formulaColumns) {
  return headers.map(function (header) {
    var name = String(header).trim();
    if (formulaColumns[name]) return '';
    switch (name) {
      case '제목': return entry.title;
      case '집코드': return bookCode;
      case '수록번호': return entry.number;
      case '성부': return 'SATB';
      case '상태': return '후보';
      case '출처': return 'youtube_channel';
      case '검증': return false;
      default: return '';
    }
  });
}
