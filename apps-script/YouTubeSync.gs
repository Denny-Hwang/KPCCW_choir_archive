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

  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt(
    '채널 ID 입력',
    '핸들로 채널을 찾지 못했습니다.\n\n' + reason + '\n\n' +
      '유튜브 채널 페이지 주소를 그대로 붙여넣으세요.\n' +
      '(youtube.com/channel/UC... 형태이거나, UC로 시작하는 24자 ID)\n\n' +
      '한 번만 입력하면 저장되고, config의 유튜브채널ID에 넣어 두어도 됩니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (answer.getSelectedButton() !== ui.Button.OK) {
    throw new Error('채널 ID 입력을 취소했습니다.');
  }

  var typed = extractChannelId_(answer.getResponseText());
  if (!typed) {
    throw new Error('채널 ID를 알아보지 못했습니다. UC로 시작하는 24자여야 합니다. 입력값: ' +
      String(answer.getResponseText() || '').trim());
  }

  props.setProperty('CHANNEL_ID', typed);
  return typed;
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

  var cache = readSheet_(ss, 'yt_cache', tz);
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

  var toAppend = [];
  var failures = [];

  for (var c = 0; c < cache.length; c++) {
    var entry = cache[c];
    var bookCode = parsePlaylistBook_(entry['재생목록명']);
    var parsed = parseVideoTitle_(entry['제목']);

    if (!bookCode || !parsed.part) {
      failures.push(entry['재생목록명'] + ' / ' + entry['제목']);
      continue;
    }

    // 1순위: 집번호 + 곡번호. 2순위: 집번호 + 곡명 정규화.
    var display = null;
    if (parsed.number) {
      display = byCode[bookCode + '-' + padNumber_(parsed.number)] || null;
    }
    if (!display && parsed.title) {
      display = byBookAndTitle[bookCode + '|' + normalizeTitle_(parsed.title)] || null;
    }

    if (!display) {
      failures.push(entry['재생목록명'] + ' / ' + entry['제목']);
      continue;
    }

    var key = display + '|' + parsed.part;
    if (seen[key]) continue; // 중복은 skip. 기존 행을 건드리지 않는다.
    seen[key] = true;

    toAppend.push([display, parsed.part, 'https://youtu.be/' + entry['videoId'], '', '', 'youtube_channel', false]);
  }

  if (toAppend.length) {
    var sheet = ss.getSheetByName('practice_links');
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 7).setValues(toAppend);
  }

  writeReport_(ss, failures);

  ui.alert(
    '영상 매칭 완료',
    '추가 ' + toAppend.length + '개 (전부 검증 대기)\n매칭 실패 ' + failures.length + '건\n\n' +
      (failures.length ? '_매칭실패 시트에 실패 목록을 적었습니다. ' : '') +
      '추가된 링크는 사람이 재생을 확인해 검증 열을 체크하기 전까지 공지에 나가지 않습니다.',
    ui.ButtonSet.OK
  );
}

/** "[중앙아트] 중앙성가 41집" → "중41". 시리즈가 늘어나면 여기에 규칙을 추가한다. */
function parsePlaylistBook_(playlistName) {
  var name = String(playlistName || '');
  var m = name.match(/중앙성가\s*(\d+)\s*집/);
  if (m) return '중' + parseInt(m[1], 10);
  return null;
}

/**
 * 영상 제목에서 곡번호·곡명·파트를 뽑는다.
 *
 * ※ 이 규칙은 잠정이다. 실제 채널의 제목 형식은 미러링을 한 번 돌려 yt_cache를
 *   눈으로 확인한 뒤에 확정해야 한다 (§11 미결정). 규칙을 고치고 "영상 매칭"을
 *   다시 실행하면 되고, API 할당량은 들지 않는다.
 */
function parseVideoTitle_(rawTitle) {
  var title = String(rawTitle || '');

  var part = null;
  var PART_PATTERNS = [
    [/(소프라노|sop|soprano)/i, '소프라노'],
    [/(알토|alt|alto)/i, '알토'],
    [/(테너|ten|tenor)/i, '테너'],
    [/(베이스|바리톤|bass)/i, '베이스'],
    [/(반주|피아노|accomp|mr)/i, '반주'],
    [/(합창|전체|full|tutti)/i, '합창']
  ];
  for (var i = 0; i < PART_PATTERNS.length; i++) {
    if (PART_PATTERNS[i][0].test(title)) { part = PART_PATTERNS[i][1]; break; }
  }
  // 파트 표기가 전혀 없으면 합창(전곡) 영상으로 본다.
  if (!part) part = '합창';

  // 대괄호·소괄호 안 채널 태그 제거 후 곡번호를 찾는다.
  var cleaned = title.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').trim();
  var numberMatch = cleaned.match(/(?:^|\s)(\d{1,2})\s*[.\-번]\s*/);
  var number = numberMatch ? parseInt(numberMatch[1], 10) : null;

  var songTitle = cleaned
    .replace(/중앙성가\s*\d+\s*집/g, ' ')
    .replace(/(?:^|\s)\d{1,2}\s*[.\-번]\s*/, ' ')
    .replace(/(소프라노|알토|테너|베이스|바리톤|합창|반주|피아노|전체|soprano|alto|tenor|bass|mr)/gi, ' ')
    // 제목 뒤에 흔히 붙는 안내 문구. 남겨두면 2순위 곡명 매칭이 헛돈다.
    .replace(/(파트\s*연습|파트|연습|음원|영상|풀버전|full)/gi, ' ')
    .replace(/[\s\-—–·]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { number: number, title: songTitle, part: part };
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

  var entries = songsFromCache_(ss, bookCode);
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

  var added = appendSongs_(ss, bookCode, entries);
  ui.alert(
    '악보집 등록 완료',
    bookCode + ' · ' + added + '곡 추가 (전부 상태=후보, 검증=FALSE)\n\n' +
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

function songsFromCache_(ss, bookCode) {
  var cache = readSheet_(ss, 'yt_cache', ss.getSpreadsheetTimeZone());
  var found = {};
  for (var i = 0; i < cache.length; i++) {
    if (parsePlaylistBook_(cache[i]['재생목록명']) !== bookCode) continue;
    var parsed = parseVideoTitle_(cache[i]['제목']);
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

function appendSongs_(ss, bookCode, entries) {
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
