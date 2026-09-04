/**
 * 읽기 전용 JSON 엔드포인트 (§2).
 *
 * 배포: 실행 주체 "나", 액세스 권한 "모든 사용자". 시트 자체는 비공개로 유지된다.
 * 대원들은 카톡 링크로 로그인 없이 앱을 열고, 앱은 이 URL 하나만 호출한다.
 *
 * 이 스크립트는 절대 쓰지 않는다. 쓰기가 필요해지면 별도 배포로 분리한다 (§12.2).
 */

/** JSON에 내보낼 데이터 시트. config의 `데이터시트목록`이 있으면 그 값이 이긴다. */
var DEFAULT_DATA_SHEETS = ['books', 'songs', 'services', 'rehearsals', 'practice_links', 'config'];

/** 시트 이름 → 응답 키. 목록에 없는 시트는 시트 이름을 그대로 키로 쓴다. */
var RESPONSE_KEYS = {
  books: 'books',
  songs: 'songs',
  services: 'services',
  rehearsals: 'rehearsals',
  practice_links: 'practiceLinks',
  config: 'config'
};

/** 내부용이라 응답에 절대 넣지 않는 시트 (§4.7). */
var NEVER_EXPORT = ['yt_cache'];

function doGet() {
  var payload;
  try {
    payload = buildPayload_();
  } catch (err) {
    payload = { error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function buildPayload_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
  var sheetNames = resolveDataSheets_(ss);

  var payload = { updatedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX") };

  for (var i = 0; i < sheetNames.length; i++) {
    var name = sheetNames[i];
    if (NEVER_EXPORT.indexOf(name) !== -1) continue;
    var key = RESPONSE_KEYS[name] || name;
    payload[key] = readSheet_(ss, name, tz);
  }

  // 화이트리스트에 없더라도 이 여섯 키는 항상 존재해야 앱이 빈 화면을 안 띄운다.
  var required = ['books', 'songs', 'services', 'rehearsals', 'practiceLinks', 'config'];
  for (var j = 0; j < required.length; j++) {
    if (!payload[required[j]]) payload[required[j]] = [];
  }

  return payload;
}

/**
 * config의 `데이터시트목록`을 우선한다. 이 값이 있으면 연도 뷰 탭(§3)이 몇 개 늘어나도
 * 스크립트가 건드리지 않는다.
 */
function resolveDataSheets_(ss) {
  var configSheet = ss.getSheetByName('config');
  if (configSheet) {
    var rows = readSheet_(ss, 'config', ss.getSpreadsheetTimeZone());
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i]['키']).trim() === '데이터시트목록') {
        var list = String(rows[i]['값'])
          .split(',')
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return s.length > 0; });
        if (list.length) return list;
      }
    }
  }
  return DEFAULT_DATA_SHEETS;
}

/**
 * 헤더 행의 이름을 키로 쓴다 (§원칙). 열 위치에 의존하지 않으므로
 * 편집자가 열을 삽입·삭제해도 앱이 깨지지 않는다.
 */
function readSheet_(ss, name, tz) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var obj = {};
    var hasValue = false;

    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue; // 이름 없는 열은 무시한다.
      var value = normalizeCell_(row[c], tz);
      obj[headers[c]] = value;
      if (value !== '') hasValue = true;
    }

    if (hasValue) out.push(obj);
  }
  return out;
}

/**
 * Date를 시트 시간대의 문자열로 바꾼다.
 *
 * JSON.stringify는 Date를 UTC ISO로 바꾼다. 시트 시간대가 UTC+ 지역이면 자정이
 * 전날로 넘어가 클라이언트가 그냥 자를 때 날짜가 하루 밀리고, PDT/PST처럼 UTC- 지역이면
 * 밀리지는 않지만 시각이 어긋난다. 어느 쪽이든 여기서 확정하는 것이 옳다.
 * 날짜/시각 구분은 시트 에폭(1899-12-30)인지로 판정한다 — 시각 전용 셀이 그 날짜를 쓴다.
 */
function normalizeCell_(value, tz) {
  if (value === null || value === undefined) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    var y = Number(Utilities.formatDate(value, tz, 'yyyy'));
    if (y <= 1900) return Utilities.formatDate(value, tz, 'HH:mm');
    var hhmm = Utilities.formatDate(value, tz, 'HH:mm');
    var ymd = Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    // 자정이면 날짜 셀로 본다. 시각이 붙어 있으면 둘 다 보존한다.
    return hhmm === '00:00' ? ymd : ymd + 'T' + hhmm;
  }

  if (typeof value === 'string') return value.trim();
  return value;
}

/** 시트 메뉴. 총무가 스크립트 편집기를 열지 않고 쓸 수 있게 한다. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('성가 아카이브')
    .addItem('시트 초기 생성', 'setupSheets')
    .addItem('연도 뷰 탭 만들기', 'createYearViewPrompt')
    .addSeparator()
    .addItem('채널 동기화', 'syncChannel')
    .addItem('영상 매칭', 'matchVideos')
    .addItem('악보집 등록', 'registerBookPrompt')
    .addSeparator()
    .addItem('엔드포인트 점검', 'validateData')
    .addToUi();
}

/**
 * 배포 전 자가 점검. 앱이 이상하게 보일 때 시트 쪽 원인을 먼저 걸러낸다.
 * 결과는 대화상자로 보여주고, 데이터는 바꾸지 않는다.
 */
function validateData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var problems = [];

  var sheets = resolveDataSheets_(ss);
  for (var i = 0; i < sheets.length; i++) {
    if (!ss.getSheetByName(sheets[i])) problems.push('시트 없음: ' + sheets[i]);
  }

  var songs = readSheet_(ss, 'songs', tz);
  var displayNames = {};
  for (var s = 0; s < songs.length; s++) {
    var display = String(songs[s]['표시명'] || '').trim();
    if (display) displayNames[display] = true;
  }

  // 드롭다운을 우회해 손으로 친 곡명은 여기서만 드러난다.
  var services = readSheet_(ss, 'services', tz);
  for (var v = 0; v < services.length; v++) {
    ['곡1', '곡2', '곡3'].forEach(function (col) {
      var title = String(services[v][col] || '').trim();
      if (title && !displayNames[title]) {
        problems.push('services의 곡명이 songs에 없음: "' + title + '" (' + services[v]['찬양일'] + ')');
      }
    });
  }

  var links = readSheet_(ss, 'practice_links', tz);
  var unverified = 0;
  for (var l = 0; l < links.length; l++) {
    var name = String(links[l]['표시명'] || '').trim();
    if (name && !displayNames[name]) problems.push('practice_links의 곡명이 songs에 없음: "' + name + '"');
    if (!toBool_(links[l]['검증'])) unverified++;
  }

  var serviceDates = {};
  for (var d = 0; d < services.length; d++) {
    var key = String(services[d]['찬양일']) + '|' + String(services[d]['예배구분'] || '');
    if (serviceDates[key]) problems.push('찬양일 중복: ' + key);
    serviceDates[key] = true;
  }

  var summary =
    '곡 ' + songs.length + ' · 예배 ' + services.length + ' · 링크 ' + links.length +
    '\n미검증 링크 ' + unverified + '개 (공지에서 제외됨)\n\n' +
    (problems.length ? '문제 ' + problems.length + '건\n\n' + problems.slice(0, 30).join('\n') : '발견된 문제 없음');

  SpreadsheetApp.getUi().alert('엔드포인트 점검', summary, SpreadsheetApp.getUi().ButtonSet.OK);
}

function toBool_(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'y' || s === 'yes' || s === '1' || s === '예';
}
