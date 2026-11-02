// HDRezka core plugin loaded by hdrezka.js.
(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.hdrezka_core_started) return;
  if (typeof window !== 'undefined') window.hdrezka_core_started = true;

  var network = new Lampa.Reguest();

    function startsWith(str, searchString) {
      return str.lastIndexOf(searchString, 0) === 0;
    }

    function endsWith(str, searchString) {
      var start = str.length - searchString.length;
      if (start < 0) return false;
      return str.indexOf(searchString, start) === start;
    }

    function hdrezkaMirror() {
      var url = Lampa.Storage.get('hdrezka_mirror', '') + '';
      if (!url) return 'https://kvk.zone';
      if (url.indexOf('://') == -1) url = 'https://' + url;
      if (url.charAt(url.length - 1) === '/') url = url.substring(0, url.length - 1);
      return url;
    }

    // BEGIN HDREZKA LOCAL PROXY LOGIC
    function normalizeHdrezkaLocalProxy(value) {
      var url = (value || '').toString().trim();
      if (!/^https?:\/\//i.test(url)) return '';
      return url.replace(/\/+$/, '') + '/';
    }

    function hdrezkaLocalProxyList() {
      var result = [];

      for (var index = 1; index <= 3; index++) {
        var proxy_url = normalizeHdrezkaLocalProxy(Lampa.Storage.get('hdrezka_local_proxy_' + index, ''));
        if (proxy_url && result.indexOf(proxy_url) === -1) result.push(proxy_url);
      }

      return result;
    }

    function createHdrezkaLocalProxyChain(proxies) {
      var items = (proxies || []).slice();
      var index = 0;

      return {
        current: function current() {
          return items[index] || '';
        },
        advance: function advance(failed_proxy) {
          if (items[index] === failed_proxy) {
            if (index + 1 >= items.length) return '';
            index++;
          }
          return items[index] || '';
        },
        index: function proxyIndex() {
          return index;
        },
        size: function size() {
          return items.length;
        }
      };
    }

    function shouldFailoverHdrezkaLocalProxy(response) {
      var status = response && parseInt(response.status, 10) || 0;
      return status === 0 || status === 502 || status === 503 || status === 504;
    }

    function hdrezkaLocalProxyConfigError() {
      if (!hdrezkaLocalProxyList().length) return Lampa.Lang.translate('hdrezka_local_proxy_missing_error');
      return '';
    }

    function requestThroughHdrezkaLocalProxy(chain, network, build_url, success, error, post_data, options, timeout) {
      var attempts = 0;
      var send = function send() {
        var local_proxy = chain.current();
        if (!local_proxy) {
          if (error) error({
            status: 0,
            statusText: 'local-proxy-unavailable',
            responseText: Lampa.Lang.translate('hdrezka_local_proxy_unavailable_error')
          }, Lampa.Lang.translate('hdrezka_local_proxy_unavailable_error'));
          return;
        }

        var request_url = build_url(local_proxy);
        attempts++;
        network.clear();
        network.timeout(timeout || 10000);
        network["native"](request_url, function (data) {
          if (success) success(data, local_proxy, request_url);
        }, function (response, reason) {
          if (shouldFailoverHdrezkaLocalProxy(response)) {
            var next_proxy = chain.advance(local_proxy);
            if (next_proxy) {
              hdrezkaDebug('local proxy failover', {
                failedProxy: local_proxy,
                nextProxy: next_proxy,
                attempt: attempts,
                status: response && response.status || 0,
                reason: reason || ''
              });
              send();
              return;
            }
          }
          if (error) error(response, reason);
        }, post_data, options);
      };

      send();
    }
    // END HDREZKA LOCAL PROXY LOGIC

    function baseUserAgent() {
      return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
    }

    function parseURL(link) {
      var url = {
        href: link,
        protocol: '',
        host: '',
        origin: '',
        pathname: '',
        search: '',
        hash: ''
      };
      var pos = link.indexOf('#');

      if (pos !== -1) {
        url.hash = link.substring(pos);
        link = link.substring(0, pos);
      }

      pos = link.indexOf('?');

      if (pos !== -1) {
        url.search = link.substring(pos);
        link = link.substring(0, pos);
      }

      pos = link.indexOf(':');
      var path_pos = link.indexOf('/');

      if (pos !== -1 && (path_pos === -1 || path_pos > pos)) {
        url.protocol = link.substring(0, pos + 1);
        link = link.substring(pos + 1);
      }

      if (startsWith(link, '//')) {
        pos = link.indexOf('/', 2);

        if (pos !== -1) {
          url.host = link.substring(2, pos);
          link = link.substring(pos);
        } else {
          url.host = link.substring(2);
          link = '/';
        }

        url.origin = url.protocol + '//' + url.host;
      }

      url.pathname = link;
      return url;
    }

    function fixLink(link, referrer) {
      if (link) {
        if (!referrer || link.indexOf('://') !== -1) return link;
        var url = parseURL(referrer);
        if (startsWith(link, '//')) return url.protocol + link;
        if (startsWith(link, '/')) return url.origin + link;
        if (startsWith(link, '?')) return url.origin + url.pathname + link;
        if (startsWith(link, '#')) return url.origin + url.pathname + url.search + link;
        var base = url.origin + url.pathname;
        base = base.substring(0, base.lastIndexOf('/') + 1);
        return base + link;
      }

      return link;
    }

    function fixLinkProtocol(link, prefer_http, replace_protocol) {
      if (link) {
        if (startsWith(link, '//')) {
          return (prefer_http ? 'http:' : 'https:') + link;
        } else if (prefer_http && replace_protocol) {
          return link.replace('https://', 'http://');
        } else if (!prefer_http && replace_protocol === 'full') {
          return link.replace('http://', 'https://');
        }
      }

      return link;
    }

    function proxyLink(link, proxy, proxy_enc, enc) {
      if (link && proxy) {
        if (proxy_enc == null) proxy_enc = '';
        if (enc == null) enc = 'enc';

        if (enc === 'enc') {
          var pos = link.indexOf('/');
          if (pos !== -1 && link.charAt(pos + 1) === '/') pos++;
          var part1 = pos !== -1 ? link.substring(0, pos + 1) : '';
          var part2 = pos !== -1 ? link.substring(pos + 1) : link;
          return proxy + 'enc/' + encodeURIComponent(btoa(proxy_enc + part1)) + '/' + part2;
        }

        if (enc === 'enc1') {
          var _pos = link.lastIndexOf('/');

          var _part = _pos !== -1 ? link.substring(0, _pos + 1) : '';

          var _part2 = _pos !== -1 ? link.substring(_pos + 1) : link;

          return proxy + 'enc1/' + encodeURIComponent(btoa(proxy_enc + _part)) + '/' + _part2;
        }

        if (enc === 'enc2' || enc === 'enc2t') {
          var posEnd = link.lastIndexOf('?');
          var posStart = link.lastIndexOf('://');
          if (posEnd === -1 || posEnd <= posStart) posEnd = link.length;
          if (posStart === -1) posStart = -3;
          var name = link.substring(posStart + 3, posEnd);
          posStart = name.lastIndexOf('/');
          name = posStart !== -1 ? name.substring(posStart + 1) : '';
          name = name.replace(/\.(php|asp|aspx|jsp|jspx|cgi|pl|py|rb|env|ini|conf|config|htaccess|htpasswd|git|yml|yaml|sql)$/, '.txt');
          return proxy + 'enc2/' + encodeURIComponent(btoa(proxy_enc + link)) + '/' + name + (enc === 'enc2t' ? '?jacred.test' : '');
        }

        return proxy + proxy_enc + link;
      }

      return link;
    }

    function randomChars(chars, len) {
      var result = '';
      for (var index = 0; index < len; index++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    function randomId(len, extra) {
      return randomChars('0123456789abcdefghijklmnopqrstuvwxyz' + (extra || ''), len);
    }
    function hdrezkaSearchText(value) {
      return (value || '').toString().replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, function (_, code) {
        return String.fromCharCode(parseInt(code, 10));
      }).replace(/\s+/g, ' ').trim();
    }

    function hdrezkaSearchAttribute(markup, name) {
      var match = (markup || '').match(new RegExp(name + "\\s*=\\s*[\\\"']([^\\\"']*)[\\\"']", 'i'));
      return match ? hdrezkaSearchText(match[1]) : '';
    }

    function hdrezkaSearchResult(markup) {
      var anchor = (markup || '').match(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>[\s\S]*?<\/a>/i);
      if (!anchor) return null;
      var anchorMarkup = anchor[0];
      var link = hdrezkaSearchAttribute(anchorMarkup, 'href');
      var inner = anchorMarkup.replace(/^<[\s\S]*?>/, '').replace(/<\/a>\s*$/i, '');
      var titleMatch = inner.match(/<[^>]*class\s*=\s*["'][^"']*\benty\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
      var title = titleMatch ? hdrezkaSearchText(titleMatch[1]) : hdrezkaSearchText(inner);
      var plain = hdrezkaSearchText(markup);
      var yearMatch = plain.match(/\b((?:19|20)\d{2})\b/);
      var titleYearMatch = title.match(/\(([^()]*)[, ]+((?:19|20)\d{2})(?:\s*[-–]\s*[^)]*)?\)$/);
      var original = hdrezkaSearchAttribute(markup, 'data-original-title') || hdrezkaSearchAttribute(markup, 'data-original') || (titleYearMatch ? hdrezkaSearchText(titleYearMatch[1]).replace(/[, ]+$/, '') : '');
      var typeAttribute = hdrezkaSearchAttribute(markup, 'data-type');
      var type = typeAttribute || (/сериал|series|season|мультсериал/i.test(plain) ? 'series' : 'movie');
      var poster = hdrezkaSearchAttribute(markup, 'data-src') || hdrezkaSearchAttribute(markup, 'data-original') || hdrezkaSearchAttribute(markup, 'src');

      return {
        title: title,
        orig_title: original,
        year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
        type: type,
        poster: poster,
        link: link
      };
    }

    function hdrezkaSearchUnique(items) {
      var result = [];
      (items || []).forEach(function (item) {
        if (!item || !item.link) return;
        var duplicate = result.some(function (saved) {
          return saved.link === item.link;
        });
        if (!duplicate) result.push(item);
      });
      return result;
    }

    function parseHdrezkaAjaxResults(markup) {
      var items = [];
      var blocks = (markup || '').match(/<li\b[\s\S]*?<\/li>/gi) || [];
      blocks.forEach(function (block) {
        var item = hdrezkaSearchResult(block);
        if (item) items.push(item);
      });
      return hdrezkaSearchUnique(items);
    }

    function parseHdrezkaHtmlResults(markup) {
      var items = [];
      var blocks = (markup || '').match(/<div\b[^>]*class\s*=\s*["'][^"']*b-content__inline_item-link[^"']*["'][\s\S]*?<\/div>\s*<\/div>/gi) || [];
      blocks.forEach(function (block) {
        var item = hdrezkaSearchResult(block);
        if (item) items.push(item);
      });
      return hdrezkaSearchUnique(items);
    }

    function hdrezkaNormalizeTitle(value) {
      return hdrezkaSearchText(value).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
    }

    function hdrezkaSearchHasConfidentResult(items, selectedTitle, originalTitles, year) {
      var expected = [selectedTitle].concat(originalTitles || []).map(hdrezkaNormalizeTitle).filter(Boolean);
      var exact = (items || []).filter(function (item) {
        var values = [item.title, item.orig_title].map(hdrezkaNormalizeTitle);
        return values.some(function (value) {
          return expected.indexOf(value) !== -1;
        });
      });
      if (exact.length !== 1) return false;
      if (!year || !exact[0].year) return true;
      return Math.abs(parseInt(exact[0].year, 10) - parseInt(year, 10)) <= 1;
    }

    function hdrezka(component, _object, config) {
      var network = new Lampa.Reguest();
      var extract = {};
      var object = _object;
      var select_title = '';
      var prefer_http = Lampa.Storage.field('hdrezka_prefer_http') === true;
      var prefer_mp4 = Lampa.Storage.field('hdrezka_prefer_mp4') === true;
      var local_proxy_error = Utils.hdrezkaLocalProxyConfigError();
      var local_proxy_chain = Utils.createHdrezkaLocalProxyChain(Utils.hdrezkaLocalProxyList());
      var prox = local_proxy_chain.current();
      var host = Utils.hdrezkaMirror();
      var ref = host + '/';
      var logged_in = false;
      var user_agent = Utils.baseUserAgent();
      var headers = Lampa.Platform.is('android') ? {
        'Origin': host,
        'Referer': ref,
        'User-Agent': user_agent
      } : {};
      var prox_enc = '';
      var prox_enc_base = '';

      if (prox) {
        prox_enc_base += 'param/Origin=' + encodeURIComponent(host) + '/';
        prox_enc_base += 'param/Referer=' + encodeURIComponent(ref) + '/';
        prox_enc_base += 'param/User-Agent=' + encodeURIComponent(user_agent) + '/';
        prox_enc = prox_enc_base;
      }

      var cookie = Lampa.Storage.get('hdrezka_cookie', '') + '';
      if (cookie.indexOf('PHPSESSID=') == -1) cookie = 'PHPSESSID=' + Utils.randomId(26) + (cookie ? '; ' + cookie : '');

      // HDRezka's browser and official app clients send these cookies on
      // every page and AJAX request. Without them the site may answer a
      // valid, authenticated request with a chain of unrelated film pages.
      var browser_cookies = {
        allowed_comments: '1',
        _ym_isad: '1',
        _ym_visorc: 'b',
        dle_newpm: '0'
      };
      var cookie_names = {};
      cookie.split(';').forEach(function (part) {
        var pos = part.indexOf('=');
        if (pos !== -1) cookie_names[part.substring(0, pos).trim()] = true;
      });
      for (var browser_cookie_name in browser_cookies) {
        if (!cookie_names[browser_cookie_name]) {
          cookie += (cookie ? '; ' : '') + browser_cookie_name + '=' + browser_cookies[browser_cookie_name];
        }
      }
      Lampa.Storage.set('hdrezka_cookie', cookie);

      if (cookie) {
        if (Lampa.Platform.is('android')) {
          headers.Cookie = cookie;
        }

        if (prox) {
          prox_enc = prox_enc_base + 'param/Cookie=' + encodeURIComponent(cookie) + '/';
        }
      }

      function mergeResponseCookies(json) {
        var setCookies = hdrezkaCookieHeaders(json);
        if (!setCookies || !setCookies.forEach) return false;
        var values = {};
        cookie.split(';').forEach(function (part) {
          var pos = part.indexOf('=');
          if (pos !== -1) values[part.substring(0, pos).trim()] = part.substring(pos + 1).trim();
        });
        setCookies.forEach(function (param) {
          var first = (param || '').split(';')[0];
          var pos = first.indexOf('=');
          if (pos === -1) return;
          var name = first.substring(0, pos).trim();
          var value = first.substring(pos + 1).trim();
          if (!name) return;
          if (value === 'deleted') delete values[name];else values[name] = value;
        });
        var result = [];
        for (var name in values) result.push(name + '=' + values[name]);
        cookie = result.join('; ');
        Lampa.Storage.set('hdrezka_cookie', cookie);
        if (prox) prox_enc = prox_enc_base + 'param/Cookie=' + encodeURIComponent(cookie) + '/';
        hdrezkaDebug('Anubis cookies merged', hdrezkaCookiePreview(cookie));
        return true;
      }

      function cookieProxyEncoding(mode) {
        return prox_enc_base + (mode || '') + 'param/Cookie=' + encodeURIComponent(cookie) + '/';
      }

      function localProxyRequest(url, success, error, postdata, options, encoding, timeout) {
        Utils.requestThroughHdrezkaLocalProxy(local_proxy_chain, network, function (local_proxy) {
          return component.proxyLink(url, local_proxy, encoding == null ? prox_enc : encoding, 'enc2t');
        }, function (data, local_proxy, request_url) {
          prox = local_proxy;
          hdrezkaDebug('local proxy request success', {
            proxy: local_proxy
          });
          if (success) success(data);
        }, error, postdata, options, timeout || 10000);
      }

      function solveAnubisPow(randomData, difficulty, callback, fail) {
        function sha256(ascii) {
          var math = Math;
          var words = [];
          var bitLength = ascii.length * 8;
          var hash = sha256.h = sha256.h || [];
          var k = sha256.k = sha256.k || [];
          var primeCounter = k.length;
          var isPrime = {};
          for (var candidate = 2; primeCounter < 64; candidate++) {
            if (!isPrime[candidate]) {
              for (var multiple = candidate * candidate; multiple < 312; multiple += candidate) isPrime[multiple] = true;
              hash[primeCounter] = (math.sqrt(candidate) * 0x100000000) | 0;
              k[primeCounter++] = (math.pow(candidate, 1 / 3) * 0x100000000) | 0;
            }
          }
          ascii += '\x80';
          while (ascii.length % 64 !== 56) ascii += '\x00';
          for (var i = 0; i < ascii.length; i++) words[i >> 2] |= ascii.charCodeAt(i) << ((3 - i) % 4) * 8;
          words[words.length] = (bitLength / 0x100000000) | 0;
          words[words.length] = bitLength | 0;
          for (var offset = 0; offset < words.length;) {
            var w = words.slice(offset, offset += 16);
            var oldHash = hash.slice(0);
            for (var j = 0; j < 64; j++) {
              var w15 = w[j - 15], w2 = w[j - 2];
              var a = hash[0], e = hash[4];
              var temp1 = (hash[7] + (right(e, 6) ^ right(e, 11) ^ right(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[j] + (w[j] = j < 16 ? w[j] : (w[j - 16] + (right(w15, 7) ^ right(w15, 18) ^ (w15 >>> 3)) + w[j - 7] + (right(w2, 17) ^ right(w2, 19) ^ (w2 >>> 10))) | 0)) | 0;
              var temp2 = ((right(a, 2) ^ right(a, 13) ^ right(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))) | 0;
              hash = [(temp1 + temp2) | 0].concat(hash);
              hash[4] = (hash[4] + temp1) | 0;
              hash.length = 8;
            }
            for (var h = 0; h < 8; h++) hash[h] = (hash[h] + oldHash[h]) | 0;
          }
          var output = '';
          for (var n = 0; n < 8; n++) for (var shift = 28; shift >= 0; shift -= 4) output += ((hash[n] >>> shift) & 15).toString(16);
          return output;
          function right(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
        }
        var prefix = new Array(difficulty + 1).join('0');
        var nonce = 0;
        var started = Date.now();
        var step = function step() {
          try {
            var stop = nonce + 64;
            while (nonce < stop) {
              var hash = sha256(randomData + nonce);
              if (hash.indexOf(prefix) === 0) {
                callback({ hash: hash, nonce: nonce, elapsed: Date.now() - started });
                return;
              }
              nonce++;
            }
            if (nonce % 1024 < 64) {
              hdrezkaDebug('Anubis progress', { nonce: nonce, elapsed: Date.now() - started });
            }
            setTimeout(step, 0);
          } catch (error) {
            fail(error && error.message || String(error));
          }
        };
        step();
      }

      hdrezkaDebug('source request config', {
        host: host,
        proxy: prox || 'not-configured',
        proxyCount: local_proxy_chain.size(),
        cookie: hdrezkaCookieSummary(cookie)
      });

      var embed = ref;
      var filter_items = {};
      var choice = {
        season: 0,
        voice: 0,
        voice_name: '',
        season_id: ''
      };
      var error_message = '';

      function checkErrorForm(str) {
        var login_form = str.match(/<form id="check-form" class="check-form" method="post" action="\/ajax\/login\/">/) || str.match(/<form id="loginForm" action="\/ajax\/login\/"/);

        if (login_form) {
          error_message = Lampa.Lang.translate('hdrezka_authorization_required') + ' HDRezka';
          return;
        }

        var error_form = str.match(/(<div class="error-code">[^<]*<div>[^<]*<\/div>[^<]*<\/div>)\s*(<div class="error-title">[^<]*<\/div>)/);

        if (error_form) {
          error_message = ($(error_form[1]).text().trim() || '') + ':\n' + ($(error_form[2]).text().trim() || '');
          return;
        }

        var verify_form = str.match(/<span>MIRROR<\/span>.*<button type="submit" onclick="\$\.cookie(\([^)]*\))/);

        if (verify_form) {
          error_message = Lampa.Lang.translate('hdrezka_unsupported_mirror') + ' HDRezka';
          return;
        }

        var anubis_form = str.match(/<script id="anubis_challenge"/);

        if (anubis_form) {
          error_message = Lampa.Lang.translate('hdrezka_unsupported_mirror') + ' HDRezka';
          return;
        }

        if (startsWith(str, 'Fatal error:')) {
          error_message = str;
          return;
        }
      }


      this.search = function (_object, kinopoisk_id, data) {
        var _this = this;

        if (local_proxy_error) {
          component.empty(local_proxy_error);
          return;
        }

        object = _object;
        select_title = object.search || object.movie.title;
        if (this.wait_similars && data && data[0].is_similars) return getPage(data[0].link);
        error_message = '';
        var search_date = object.search_date || !object.clarification && (object.movie.release_date || object.movie.first_air_date || object.movie.last_air_date) || '0000';
        var search_year = parseInt((search_date + '').slice(0, 4));
        var orig_titles = [];

        if (object.movie.alternative_titles && object.movie.alternative_titles.results) {
          orig_titles = object.movie.alternative_titles.results.map(function (t) {
            return t.title;
          });
        }

        if (object.movie.original_title) orig_titles.push(object.movie.original_title);
        if (object.movie.original_name) orig_titles.push(object.movie.original_name);
        var url = embed + 'engine/ajax/search.php';
        var more_url = embed + 'search/?do=search&subaction=search';

        var query_more = function query_more(query, page, data, callback) {
          var url = more_url + '&q=' + encodeURIComponent(query) + '&page=' + encodeURIComponent(page);
          hdrezkaDebug('HTML search request', {
            target: url,
            proxy: prox
          });
          localProxyRequest(url, function (str) {
              str = (str || '').replace(/\n/g, '');
              checkErrorForm(str);
              var links = parseHdrezkaHtmlResults(str);
              var have_more = !!str.match(/<a [^>]*>\s*<span class="b-navigation__next\b/);

              if (links && links.length) {
                data = data.concat(links);
              }

              if (callback) callback(data, have_more);
          }, function (a, c) {
            component.empty(network.errorDecode(a, c));
          }, false, {
            dataType: 'text',
            withCredentials: logged_in,
            headers: headers
          });
        };

        var search_more = function search_more(params) {
          var items = params.items || [];
          var query = params.query || '';
          var page = params.page || 1;
          query_more(query, page, items, function (items, have_more) {
            if (items && items.length) {
              _this.wait_similars = true;
              items.forEach(function (c) {
                c.is_similars = true;
              });

              if (have_more) {
                component.similars(items, search_more, {
                  items: [],
                  query: query,
                  page: page + 1
                });
              } else {
                component.similars(items);
              }

              component.loading(false);
            } else if (error_message) component.empty(error_message);else component.emptyForQuery(select_title);
          });
        };

        var display = function display(links, have_more, query) {
          if (links && links.length && links.forEach) {
            var is_sure = false;
            var items = links.map(function (l) {
              if (l && typeof l === 'object' && l.link) {
                return {
                  year: l.year,
                  title: l.title || '',
                  orig_title: l.orig_title || '',
                  type: l.type || '',
                  poster: l.poster || '',
                  link: l.link
                };
              }

              var li = $(l);
              var link = $('a', li);
              var enty = $('.enty', link);
              var rating = $('.rating', link);
              var titl = enty.text().trim() || '';
              enty.remove();
              rating.remove();
              var alt_titl = link.text().trim() || '';
              var orig_title = '';
              var year;
              var found = alt_titl.match(/\((.*,\s*)?\b(\d{4})(\s*-\s*[\d.]*)?\)$/);

              if (found) {
                if (found[1]) {
                  var found_alt = found[1].match(/^([^а-яА-ЯёЁ]+),/);
                  if (found_alt) orig_title = found_alt[1].trim();
                }

                year = parseInt(found[2]);
              }

              return {
                year: year,
                title: titl,
                orig_title: orig_title,
                link: link.attr('href') || ''
              };
            });
            var cards = items;

            if (cards.length) {
              if (orig_titles.length) {
                var tmp = cards.filter(function (c) {
                  return component.containsAnyTitle([c.orig_title, c.title], orig_titles);
                });

                if (tmp.length) {
                  cards = tmp;
                  is_sure = true;
                }
              }

              if (select_title) {
                var _tmp = cards.filter(function (c) {
                  return component.containsAnyTitle([c.title, c.orig_title], [select_title]);
                });

                if (_tmp.length) {
                  cards = _tmp;
                  is_sure = true;
                }
              }

              if (cards.length > 1 && search_year) {
                var _tmp2 = cards.filter(function (c) {
                  return c.year == search_year;
                });

                if (!_tmp2.length) _tmp2 = cards.filter(function (c) {
                  return c.year && c.year > search_year - 2 && c.year < search_year + 2;
                });
                if (_tmp2.length) cards = _tmp2;
              }
            }

            if (cards.length == 1 && is_sure) {
              if (search_year && cards[0].year) {
                is_sure = cards[0].year > search_year - 2 && cards[0].year < search_year + 2;
              }

              if (is_sure) {
                is_sure = false;

                if (orig_titles.length) {
                  is_sure |= component.equalAnyTitle([cards[0].orig_title, cards[0].title], orig_titles);
                }

                if (select_title) {
                  is_sure |= component.equalAnyTitle([cards[0].title, cards[0].orig_title], [select_title]);
                }
              }
            }

            if (cards.length == 1 && is_sure) getPage(cards[0].link);else if (items.length) {
              _this.wait_similars = true;
              items.forEach(function (c) {
                c.is_similars = true;
              });

              if (have_more) {
                component.similars(items, search_more, {
                  items: [],
                  query: query,
                  page: 1
                });
              } else {
                component.similars(items);
              }

              component.loading(false);
            } else component.emptyForQuery(select_title);
          } else if (error_message) component.empty(error_message);else component.emptyForQuery(select_title);
        };

        var query_search = function query_search(query, data, callback) {
          var postdata = 'q=' + encodeURIComponent(query);
          hdrezkaDebug('search request', {
            target: url,
            proxy: prox
          });
          localProxyRequest(url, function (str) {
            str = (str || '').replace(/\n/g, '');
            checkErrorForm(str);
            var links = parseHdrezkaAjaxResults(str);
            var have_more = str.indexOf('<a class="b-search__live_all"') !== -1;
            if (links && links.length) data = data.concat(links);
            if (hdrezkaSearchHasConfidentResult(data, select_title, orig_titles, search_year) || !query_more) {
              if (callback) callback(data, have_more, query);
              return;
            }

            query_more(query, 1, [], function (html_items, html_have_more) {
              if (html_items && html_items.length) {
                callback(html_items, html_have_more, query);
              } else {
                callback(data, have_more, query);
              }
            });
          }, function (a, c) {
            if (a.status == 403 && a.responseText) {
              var str = (a.responseText || '').replace(/\n/g, '');
              checkErrorForm(str);
            }

            if (!error_message && query_more) {
              query_more(query, 1, [], function (html_items, html_have_more) {
                if (html_items && html_items.length) {
                  callback(html_items, html_have_more, query);
                } else {
                  component.empty(network.errorDecode(a, c));
                }
              });
              return;
            }

            if (error_message) component.empty(error_message);else component.empty(network.errorDecode(a, c));
          }, postdata, {
            dataType: 'text',
            withCredentials: logged_in,
            headers: headers
          });
        };

        var query_title_search = function query_title_search() {
          var query = component.cleanTitle(select_title);

          query_search(query, [], function (data, have_more, query) {
            if (data && data.length && data.forEach) display(data, have_more, query);else display([]);
          });
        };

        query_title_search();
      };

      this.extendChoice = function (saved) {
        Lampa.Arrays.extend(choice, saved, true);
      };


      this.reset = function () {
        component.reset();
        choice = {
          season: 0,
          voice: 0,
          voice_name: '',
          season_id: ''
        };
        component.loading(true);
        getEpisodes(success);
        component.saveChoice(choice);
      };


      this.filter = function (type, a, b) {
        choice[a.stype] = b.index;
        if (a.stype == 'voice') choice.voice_name = filter_items.voice[b.index];
        if (a.stype == 'season') choice.season_id = filter_items.season_id[b.index];
        component.reset();
        component.loading(true);
        getEpisodes(success);
        component.saveChoice(choice);
        setTimeout(component.closeFilter, 10);
      };


      this.destroy = function () {
        network.clear();
        extract = null;
      };

      var anubis_attempted = false;

      function finishPage(str) {
        if ((str || '').indexOf('<script id="anubis_challenge"') !== -1) {
          passAnubis(current_page_url);
          return;
        }
        extractData(str);
        if (extract.film_id) getEpisodes(success);else if (error_message) component.empty(error_message);else component.emptyForQuery(select_title);
      }

      var current_page_url = '';

      function getPageWithCookies(url, redirectCount) {
        if (redirectCount > 12) {
          component.empty('HDrezka: превышен лимит служебных перенаправлений');
          return;
        }
        hdrezkaDebug('page redirect step', { step: redirectCount, target: url });
        localProxyRequest(url, function (json) {
          if (typeof json === 'string') {
            try { json = JSON.parse(json); } catch (e) {}
          }
          if (!json || typeof json !== 'object') {
            component.empty('HDrezka: некорректный ответ прокси');
            return;
          }
          mergeResponseCookies(json);
          if (json.redirectUrl) {
            getPageWithCookies(component.fixLink(json.redirectUrl, ref), redirectCount + 1);
            return;
          }
          finishPage(json.body || '');
        }, function (a, c) {
          hdrezkaDebug('page redirect error', { status: a && a.status, response: a && a.responseText, error: c });
          component.empty(network.errorDecode(a, c));
        }, false, { dataType: 'text', headers: headers }, cookieProxyEncoding('get_redirect/cookie_plus/'), 15000);
      }

      function passAnubis(url) {
        if (!prox || anubis_attempted) {
          component.empty('HDrezka: проверка Anubis не пройдена');
          return;
        }
        anubis_attempted = true;
        component.loading(true);
        hdrezkaDebug('Anubis challenge detected', { target: url });
        localProxyRequest(url, function (json) {
          if (typeof json === 'string') {
            try { json = JSON.parse(json); } catch (e) {}
          }
          var body = json && json.body || '';
          mergeResponseCookies(json);
          var challengeMatch = body.match(/<script id="anubis_challenge" type="application\/json">([\s\S]*?)<\/script>/);
          if (!challengeMatch) {
            component.empty('HDrezka: данные проверки Anubis не найдены');
            return;
          }
          var payload;
          try { payload = JSON.parse(challengeMatch[1]); } catch (e) {
            component.empty('HDrezka: ошибка чтения Anubis challenge');
            return;
          }
          var challenge = payload.challenge || {};
          var rules = payload.rules || {};
          hdrezkaDebug('Anubis solving', { id: challenge.id, difficulty: rules.difficulty });
          solveAnubisPow(challenge.randomData || '', parseInt(rules.difficulty || 4), function (solution) {
            hdrezkaDebug('Anubis solution found', solution);
            var passTarget = host + '/.within.website/x/cmd/anubis/api/pass-challenge?id=' + encodeURIComponent(challenge.id || '') + '&response=' + encodeURIComponent(solution.hash) + '&nonce=' + encodeURIComponent(solution.nonce) + '&redir=' + encodeURIComponent(url) + '&elapsedTime=' + encodeURIComponent(solution.elapsed);
            localProxyRequest(passTarget, function (passJson) {
              if (typeof passJson === 'string') {
                try { passJson = JSON.parse(passJson); } catch (e) {}
              }
              mergeResponseCookies(passJson);
              hdrezkaDebug('Anubis pass response', {
                currentUrl: passJson && passJson.currentUrl,
                redirectUrl: passJson && passJson.redirectUrl,
                cookieCount: passJson && passJson.cookie && passJson.cookie.length || 0
              });
              error_message = '';
              getPageWithCookies(url, 0);
            }, function (a, c) {
              hdrezkaDebug('Anubis pass error', { status: a && a.status, response: a && a.responseText, error: c });
              component.empty('HDrezka: не удалось подтвердить Anubis');
            }, false, { dataType: 'text', headers: headers }, cookieProxyEncoding('get_redirect/cookie_plus/'), 20000);
          }, function (message) {
            component.empty('HDrezka: ошибка вычисления Anubis — ' + message);
          });
        }, function (a, c) {
          hdrezkaDebug('Anubis challenge request error', { status: a && a.status, response: a && a.responseText, error: c });
          component.empty('HDrezka: не удалось получить Anubis challenge');
        }, false, { dataType: 'text', headers: headers }, cookieProxyEncoding('cookie_plus/'), 20000);
      }

      function getPage(url) {
        url = component.fixLink(url, ref);
        current_page_url = url;
        getPageWithCookies(url, 0);
      }

      function success() {
        component.loading(false);
        filter();
        append(filtred());
      }


      function extractData(str) {
        extract.voice = [];
        extract.season = [];
        extract.episode = [];
        extract.voice_data = {};
        extract.is_series = false;
        extract.film_id = '';
        extract.favs = '';
        str = (str || '').replace(/\n/g, '');
        checkErrorForm(str);
        var translation = str.match(/<h2>В переводе<\/h2>:<\/td>\s*(<td>.*?<\/td>)/);
        var cdnSeries = str.match(/\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
        var cdnMovie = str.match(/\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
        var devVoiceName;

        if (translation) {
          devVoiceName = $(translation[1]).text().trim();
        }

        if (!devVoiceName) devVoiceName = 'Оригинал';
        var defVoice, defSeason, defEpisode;

        if (cdnSeries) {
          extract.is_series = true;
          extract.film_id = cdnSeries[1];
          defVoice = {
            name: devVoiceName,
            id: cdnSeries[2]
          };
          defSeason = {
            name: 'Сезон ' + cdnSeries[3],
            id: cdnSeries[3]
          };
          defEpisode = {
            name: 'Серия ' + cdnSeries[4],
            season_id: cdnSeries[3],
            episode_id: cdnSeries[4]
          };
        } else if (cdnMovie) {
          extract.film_id = cdnMovie[1];
          defVoice = {
            name: devVoiceName,
            id: cdnMovie[2],
            is_camrip: cdnMovie[3],
            is_ads: cdnMovie[4],
            is_director: cdnMovie[5]
          };
        }

        var voices = str.match(/(<ul id="translators-list".*?<\/ul>)/);

        if (voices) {
          var select = $(voices[1]);
          $('.b-translator__item', select).each(function () {
            var title = ($(this).attr('title') || $(this).text() || '').trim();
            $('img', this).each(function () {
              var lang = ($(this).attr('title') || $(this).attr('alt') || '').trim();
              if (lang && title.indexOf(lang) == -1) title += ' (' + lang + ')';
            });
            extract.voice.push({
              name: title,
              id: $(this).attr('data-translator_id'),
              is_camrip: $(this).attr('data-camrip'),
              is_ads: $(this).attr('data-ads'),
              is_director: $(this).attr('data-director')
            });
          });
        }

        if (!extract.voice.length && defVoice) {
          extract.voice.push(defVoice);
        }

        if (extract.is_series) {
          var seasons = str.match(/(<ul id="simple-seasons-tabs".*?<\/ul>)/);

          if (seasons) {
            var _select = $(seasons[1]);

            $('.b-simple_season__item', _select).each(function () {
              extract.season.push({
                name: $(this).text(),
                id: $(this).attr('data-tab_id')
              });
            });
          }

          if (!extract.season.length && defSeason) {
            extract.season.push(defSeason);
          }

          var episodes = str.match(/(<div id="simple-episodes-tabs".*?<\/div>)/);

          if (episodes) {
            var _select2 = $(episodes[1]);

            $('.b-simple_episode__item', _select2).each(function () {
              extract.episode.push({
                name: $(this).text(),
                season_id: $(this).attr('data-season_id'),
                episode_id: $(this).attr('data-episode_id')
              });
            });
          }

          if (!extract.episode.length && defEpisode) {
            extract.episode.push(defEpisode);
          }
        }

        var favs = str.match(/<input type="hidden" id="ctrl_favs" value="([^"]*)"/);
        if (favs) extract.favs = favs[1];
        var blocked = str.match(/class="b-player__restricted__block_message"/);
        if (blocked) extract.blocked = true;
      }

      function getEpisodes(call) {
        if (extract.is_series) {
          filterVoice();

          if (extract.voice[choice.voice]) {
            var translator_id = extract.voice[choice.voice].id;
            var data = extract.voice_data[translator_id];

            if (data) {
              extract.season = data.season;
              extract.episode = data.episode;
            } else {
              var url = embed + 'ajax/get_cdn_series/?t=' + Date.now();
              var postdata = 'id=' + encodeURIComponent(extract.film_id);
              postdata += '&translator_id=' + encodeURIComponent(translator_id);
              postdata += '&favs=' + encodeURIComponent(extract.favs);
              postdata += '&action=get_episodes';
              localProxyRequest(url, function (json) {
                extractEpisodes(json, translator_id);
                call();
              }, function (a, c) {
                component.empty(network.errorDecode(a, c));
              }, postdata, {
                withCredentials: logged_in,
                headers: headers
              });
              return;
            }
          }
        }

        call();
      }

      function extractEpisodes(json, translator_id) {
        var data = {
          season: [],
          episode: []
        };

        if (json && json.seasons) {
          var select = $('<ul>' + json.seasons + '</ul>');
          $('.b-simple_season__item', select).each(function () {
            data.season.push({
              name: $(this).text(),
              id: $(this).attr('data-tab_id')
            });
          });
        }

        if (json && json.episodes) {
          var _select3 = $('<div>' + json.episodes + '</div>');

          $('.b-simple_episode__item', _select3).each(function () {
            data.episode.push({
              name: $(this).text(),
              translator_id: translator_id,
              season_id: $(this).attr('data-season_id'),
              episode_id: $(this).attr('data-episode_id')
            });
          });
        }

        extract.voice_data[translator_id] = data;
        extract.season = data.season;
        extract.episode = data.episode;
      }

      function filterVoice() {
        var voice = extract.is_series ? extract.voice.map(function (v) {
          return v.name;
        }) : [];
        if (!voice[choice.voice]) choice.voice = 0;

        if (choice.voice_name) {
          var inx = voice.indexOf(choice.voice_name);
          if (inx == -1) choice.voice = 0;else if (inx !== choice.voice) {
            choice.voice = inx;
          }
        }
      }


      function filter() {
        filter_items = {
          season: extract.season.map(function (s) {
            return s.name;
          }),
          season_id: extract.season.map(function (s) {
            return s.id;
          }),
          voice: extract.is_series ? extract.voice.map(function (v) {
            return v.name;
          }) : []
        };
        if (!filter_items.season[choice.season]) choice.season = 0;
        if (!filter_items.voice[choice.voice]) choice.voice = 0;

        if (choice.voice_name) {
          var inx = filter_items.voice.indexOf(choice.voice_name);
          if (inx == -1) choice.voice = 0;else if (inx !== choice.voice) {
            choice.voice = inx;
          }
        }

        if (choice.season_id) {
          var _inx = filter_items.season_id.indexOf(choice.season_id);

          if (_inx == -1) choice.season = 0;else if (_inx !== choice.season) {
            choice.season = _inx;
          }
        }

        component.filter(filter_items, choice);
      }


      function getStream(element, call, error) {
        if (element.stream) return call(element);
        var url = embed + 'ajax/get_cdn_series/?t=' + Date.now();
        var postdata = 'id=' + encodeURIComponent(extract.film_id);

        if (extract.is_series) {
          postdata += '&translator_id=' + encodeURIComponent(element.media.translator_id);
          postdata += '&season=' + encodeURIComponent(element.media.season_id);
          postdata += '&episode=' + encodeURIComponent(element.media.episode_id);
          postdata += '&favs=' + encodeURIComponent(extract.favs);
          postdata += '&action=get_stream';
        } else {
          postdata += '&translator_id=' + encodeURIComponent(element.media.id);
          postdata += '&is_camrip=' + encodeURIComponent(element.media.is_camrip);
          postdata += '&is_ads=' + encodeURIComponent(element.media.is_ads);
          postdata += '&is_director=' + encodeURIComponent(element.media.is_director);
          postdata += '&favs=' + encodeURIComponent(extract.favs);
          postdata += '&action=get_movie';
        }

        localProxyRequest(url, function (json) {
          if (json && json.url) {
            var video = decode(json.url),
                file = '',
                quality = false;
            var items = extractItems(video);

            if (items && items.length) {
              var regular_items = items.filter(function (item) {
                var label = item && item.label ? item.label + '' : '';
                return item.file && label.indexOf('pjs-prem-quality') === -1 && !/1080p\s*Ultra/i.test(label);
              });
              quality = {};
              regular_items.forEach(function (item) {
                quality[item.label] = item.file;
              });

              if (regular_items.length) {
                file = regular_items[0].file;
              } else if (json.premium_content) {
                error('Перевод доступен только с HDrezka Premium');
                return;
              }
            }

            if (file) {
              if (!/^https?:\/\//i.test(file)) {
                error('HDRezka: получен некорректный прямой URL потока');
                return;
              }
              element.stream = file;
              element.qualitys = quality;
              element.subtitles = parseSubtitles(json.subtitle);
              call(element);
            } else error();
          } else error();
        }, function (a, c) {
          error();
        }, postdata, {
          withCredentials: logged_in,
          headers: headers
        });
      }

      function decode(data) {
        if (!startsWith(data, '#')) return data;

        var enc = function enc(str) {
          return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
            return String.fromCharCode('0x' + p1);
          }));
        };

        var dec = function dec(str) {
          return decodeURIComponent(atob(str).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join(''));
        };

        var trashList = ['$$!!@$$@^!@#$$@', '@@@@@!##!^^^', '####^!!##!@@', '^^^!@##!!##', '$$#!!@#!@##'];
        var x = data.substring(2);
        trashList.forEach(function (trash) {
          x = x.replace('//_//' + enc(trash), '');
        });

        try {
          x = dec(x);
        } catch (e) {
          x = '';
        }

        return x;
      }



      function extractItems(str) {
        if (!str) return [];

        try {
          var items = component.parsePlaylist(str).map(function (item) {
            var int_quality = NaN;
            var quality = item.label.match(/(\d\d\d+)/);

            if (quality) {
              int_quality = parseInt(quality[1]);
            } else {
              quality = item.label.match(/(\d+)K/);

              if (quality) {
                int_quality = parseInt(quality[1]) * 1000;
              }
            }

            var links;

            if (prefer_mp4) {
              links = item.links.filter(function (url) {
                return /\.mp4$/i.test(url);
              });
            } else {
              links = item.links.filter(function (url) {
                return /\.m3u8$/i.test(url);
              });
            }

            if (!links.length) links = item.links;
            var link = links[0] || '';
            link = component.fixLinkProtocol(link, prefer_http, 'full');
            return {
              label: item.label,
              quality: int_quality,
              file: link
            };
          });
          items.sort(function (a, b) {
            if (b.quality > a.quality) return 1;
            if (b.quality < a.quality) return -1;
            if (b.label > a.label) return 1;
            if (b.label < a.label) return -1;
            return 0;
          });
          return items;
        } catch (e) {}

        return [];
      }

      function parseSubtitles(str) {
        var subtitles = [];

        if (str) {
          subtitles = component.parsePlaylist(str).map(function (item) {
            var link = item.links[0] || '';
            link = component.fixLinkProtocol(link, prefer_http, 'full');
            return {
              label: item.label,
              url: component.processSubs(link)
            };
          });
        }

        return subtitles.length ? subtitles : false;
      }


      function filtred() {
        var filtred = [];

        if (extract.is_series) {
          var season_name = filter_items.season[choice.season];
          var season_id;
          extract.season.forEach(function (season) {
            if (season.name == season_name) season_id = season.id;
          });
          var voice = filter_items.voice[choice.voice];
          extract.episode.forEach(function (episode) {
            if (episode.season_id == season_id) {
              filtred.push({
                title: component.formatEpisodeTitle(episode.season_id, null, episode.name),
                quality: '360p ~ 1080p',
                info: ' / ' + voice,
                season: parseInt(episode.season_id),
                episode: parseInt(episode.episode_id),
                media: episode
              });
            }
          });
        } else {
          extract.voice.forEach(function (voice) {
            filtred.push({
              title: voice.name || select_title,
              quality: '360p ~ 1080p',
              info: '',
              media: voice
            });
          });
        }

        return filtred;
      }


      function append(items) {
        component.reset();
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        var last_episode = component.getLastEpisode(items);
        items.forEach(function (element) {
          if (element.season) {
            element.translate_episode_end = last_episode;
            element.translate_voice = filter_items.voice[choice.voice];
          }

          var hash = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('') : object.movie.original_title);
          var view = Lampa.Timeline.view(hash);
          var item = Lampa.Template.get('hdrezka', element);
          var hash_file = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, filter_items.voice[choice.voice]].join('') : object.movie.original_title + element.title);
          element.timeline = view;
          item.append(Lampa.Timeline.render(view));

          if (Lampa.Timeline.details) {
            item.find('.online__quality').append(Lampa.Timeline.details(view, ' / '));
          }

          if (viewed.indexOf(hash_file) !== -1) item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
          item.on('hover:enter', function () {
            if (element.loading) return;
            if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
            element.loading = true;
            getStream(element, function (element) {
              element.loading = false;
              var first = {
                url: component.getDefaultQuality(element.qualitys, element.stream),
                quality: component.renameQualityMap(element.qualitys),
                subtitles: element.subtitles,
                timeline: element.timeline,
                title: element.season ? element.title : select_title + (element.title == select_title ? '' : ' / ' + element.title)
              };
              Lampa.Player.play(first);

              if (element.season && Lampa.Platform.version) {
                var playlist = [];
                items.forEach(function (elem) {
                  if (elem == element) {
                    playlist.push(first);
                  } else {
                    var cell = {
                      url: function url(call) {
                        getStream(elem, function (elem) {
                          cell.url = component.getDefaultQuality(elem.qualitys, elem.stream);
                          cell.quality = component.renameQualityMap(elem.qualitys);
                          cell.subtitles = elem.subtitles;
                          call();
                        }, function () {
                          cell.url = '';
                          call();
                        });
                      },
                      timeline: elem.timeline,
                      title: elem.title
                    };
                    playlist.push(cell);
                  }
                });
                Lampa.Player.playlist(playlist);
              } else {
                Lampa.Player.playlist([first]);
              }

              if (viewed.indexOf(hash_file) == -1) {
                viewed.push(hash_file);
                item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                Lampa.Storage.set('online_view', viewed);
              }
            }, function (error) {
              element.loading = false;
              Lampa.Noty.show(error || Lampa.Lang.translate(extract.blocked ? 'hdrezka_blockedlink' : 'hdrezka_nolink'));
            });
          });
          component.append(item);
          component.contextmenu({
            item: item,
            view: view,
            viewed: viewed,
            hash_file: hash_file,
            element: element,
            file: function file(call) {
              getStream(element, function (element) {
                call({
                  file: element.stream,
                  quality: element.qualitys
                });
              }, function (error) {
                Lampa.Noty.show(error || Lampa.Lang.translate(extract.blocked ? 'hdrezka_blockedlink' : 'hdrezka_nolink'));
              });
            }
          });
        });
        component.start(true);
      }
    }

    var network$3 = new Lampa.Reguest();

    function hdrezkaCookieSummary(cookie) {
      if (!cookie) return 'не получен';
      var names = [];
      (cookie + '').split(';').forEach(function (part) {
        var pos = part.indexOf('=');
        var name = (pos === -1 ? part : part.substring(0, pos)).trim();
        if (name) names.push(name);
      });
      return names.join(', ') + ' (' + (cookie + '').length + ' символов)';
    }

    function hdrezkaCookiePreview(cookie) {
      if (!cookie) return 'не получен';
      var summary = hdrezkaCookieSummary(cookie);
      console.log('[HDrezka debug] Cookie:', summary);
      return summary;
    }

    function hdrezkaSafeDebugValue(value, depth) {
      if (value === null || typeof value !== 'object') return value;
      if ((depth || 0) > 2) return '[nested]';
      if (value instanceof Array) return value.map(function (item) {
        return hdrezkaSafeDebugValue(item, (depth || 0) + 1);
      });
      var safe = {};
      Object.keys(value).forEach(function (key) {
        var normalized = key.toLowerCase();
        if (normalized.indexOf('cookie') !== -1 || normalized.indexOf('password') !== -1 || normalized.indexOf('response') !== -1 || normalized === 'body' || normalized === 'url' || normalized === 'request_url') return;
        safe[key] = hdrezkaSafeDebugValue(value[key], (depth || 0) + 1);
      });
      return safe;
    }

    function hdrezkaDebug(stage, data) {
      console.log('[HDRezka debug] ' + stage + ':', hdrezkaSafeDebugValue(data, 0));
    }

    function hdrezkaCookieHeaders(json) {
      if (!json) return null;
      if (json.cookie && json.cookie.forEach) return json.cookie;
      var headers = json.headers || {};
      return headers['set-cookie'] || headers['Set-Cookie'] || null;
    }

    function hdrezkaLogin(success, error) {
      var config_error = Utils.hdrezkaLocalProxyConfigError();
      if (config_error) {
        Lampa.Noty.show(config_error);
        if (error) error({ status: 0, responseText: config_error }, config_error);
        return;
      }

      hdrezkaFillCookie(function () {
        Lampa.Storage.set('hdrezka_status', 'true');
        if (success) success();
      }, function (a, c) {
        Lampa.Storage.set('hdrezka_status', 'false');
        if (error) error(a, c);
      });
    }

    function hdrezkaLogout(success, error) {
      var config_error = Utils.hdrezkaLocalProxyConfigError();
      if (config_error) {
        Lampa.Noty.show(config_error);
        if (error) error({ status: 0, responseText: config_error }, config_error);
        return;
      }

      var chain = Utils.createHdrezkaLocalProxyChain(Utils.hdrezkaLocalProxyList());
      var url = Utils.hdrezkaMirror() + '/logout/';
      var encoding = 'param/User-Agent=' + encodeURIComponent(Utils.baseUserAgent()) + '/';
      var cookie = Lampa.Storage.get('hdrezka_cookie', '') + '';
      if (cookie) encoding += 'param/Cookie=' + encodeURIComponent(cookie) + '/';

      Utils.requestThroughHdrezkaLocalProxy(chain, network$3, function (local_proxy) {
        return Utils.proxyLink(url, local_proxy, encoding, 'enc2t');
      }, function () {
        Lampa.Storage.set('hdrezka_cookie', '');
        Lampa.Storage.set('hdrezka_status', 'false');
        if (success) success();
      }, function (a, c) {
        Lampa.Storage.set('hdrezka_cookie', '');
        Lampa.Storage.set('hdrezka_status', 'false');
        Lampa.Noty.show(network$3.errorDecode(a, c));
        if (error) error(a, c);
      }, false, { dataType: 'text' }, 8000);
    }

    function hdrezkaFillCookie(success, error) {
      var config_error = Utils.hdrezkaLocalProxyConfigError();
      if (config_error) {
        Lampa.Noty.show(config_error);
        if (error) error({ status: 0, responseText: config_error }, config_error);
        return;
      }

      var chain = Utils.createHdrezkaLocalProxyChain(Utils.hdrezkaLocalProxyList());
      var prox = chain.current();
      var prox_enc = '';
      var returnHeaders = false;
      var host = Utils.hdrezkaMirror();

      var user_agent = Utils.baseUserAgent();
      var headers = {};
      prox_enc += 'param/User-Agent=' + encodeURIComponent(user_agent) + '/';
      prox_enc += 'cookie_plus/param/Cookie=/';

      function localProxyRequest(url, encoding, on_success, on_error, postdata, options) {
        Utils.requestThroughHdrezkaLocalProxy(chain, network$3, function (local_proxy) {
          return Utils.proxyLink(url, local_proxy, encoding, 'enc2t');
        }, function (data, local_proxy, request_url) {
          prox = local_proxy;
          hdrezkaDebug('login local proxy success', { proxy: local_proxy });
          if (on_success) on_success(data);
        }, on_error, postdata, options, 8000);
      }

      var url = host + '/ajax/login/';
      var login_name = Lampa.Storage.get('hdrezka_name', '') + '';
      var login_password = Lampa.Storage.get('hdrezka_password', '') + '';

      if (!login_name || !login_password) {
        hdrezkaDebug('credentials missing', {
          login: !!login_name,
          password: !!login_password
        });
        Lampa.Noty.show('HDrezka: логин или пароль не сохранён в настройках');
        if (error) error({
          status: 0,
          responseText: 'Пустой логин или пароль'
        }, 'Проверьте поля логина и пароля');
        return;
      }

      var postdata = 'login_name=' + encodeURIComponent(login_name);
      postdata += '&login_password=' + encodeURIComponent(login_password);
      postdata += '&login_not_save=0';
      hdrezkaDebug('login request', {
        host: host,
        proxy: prox,
        returnHeaders: returnHeaders
      });
      localProxyRequest(url, prox_enc, function (json) {
        hdrezkaDebug('login response', json);
        var cookie = '';
        var values = {};
        var sid = '';
        var body = json && json.body || {};
        body = typeof body === 'string' ? Lampa.Arrays.decodeJson(body, {}) : body;

        if (!body.success) {
          if (body.message) Lampa.Noty.show(typeof body.message === 'string' ? body.message : body.message.email || JSON.stringify(body.message));
          hdrezkaDebug('login rejected', body);
          if (error) error({
            status: json && json.status || 0,
            responseText: typeof json === 'string' ? json : JSON.stringify(body)
          }, 'HDrezka отклонила авторизацию');
          return;
        }

        var cookieHeaders = hdrezkaCookieHeaders(json);

        if (cookieHeaders && cookieHeaders.forEach) {
          cookieHeaders.forEach(function (param) {
            var parts = param.split(';')[0].split('=');

            if (parts[0]) {
              if (parts[1] === 'deleted') delete values[parts[0]];else values[parts[0]] = parts[1] || '';
            }
          });
          sid = values['PHPSESSID'];
          delete values['PHPSESSID'];
          var cookies = [];

          for (var name in values) {
            cookies.push(name + '=' + values[name]);
          }

          cookie = cookies.join('; ');
        }

        if (cookie) {
          Lampa.Storage.set('hdrezka_cookie', cookie);
          if (cookie.indexOf('PHPSESSID=') == -1) cookie = 'PHPSESSID=' + (sid || Utils.randomId(26)) + (cookie ? '; ' + cookie : '');
          var prox_enc2 = prox_enc;
          prox_enc2 += 'param/Cookie=' + encodeURIComponent(cookie) + '/';

          localProxyRequest(host + '/', prox_enc2, function (str) {
            var json = typeof str === 'string' ? Lampa.Arrays.decodeJson(str, {}) : str;
            var body = (json && json.body || '').replace(/\n/g, '');
            var error_form = body.match(/(<div class="error-code">[^<]*<div>[^<]*<\/div>[^<]*<\/div>)\s*(<div class="error-title">[^<]*<\/div>)/);

            if (error_form) {
              Lampa.Noty.show(error_form[0]);
              if (error) error();
              return;
            }

            var cookieHeaders = hdrezkaCookieHeaders(json);

            if (cookieHeaders && cookieHeaders.forEach) {
              cookieHeaders.forEach(function (param) {
                var parts = param.split(';')[0].split('=');

                if (parts[0]) {
                  if (parts[1] === 'deleted') delete values[parts[0]];else values[parts[0]] = parts[1] || '';
                }
              });
              sid = values['PHPSESSID'] || sid;
              delete values['PHPSESSID'];
              var _cookies = [];

              for (var _name in values) {
                _cookies.push(_name + '=' + values[_name]);
              }

              cookie = _cookies.join('; ');
              if (cookie) Lampa.Storage.set('hdrezka_cookie', cookie);
            }

            var verify_form = body.match(/<span>MIRROR<\/span>.*<button type="submit" onclick="\$\.cookie(\([^)]*\))/);

            if (verify_form) {
              var verify_cookie;

              try {
                verify_cookie = (0, eval)('"use strict"; (function(name, value){ return {name: name, value: value}; })' + verify_form[1] + ';');
              } catch (e) {}

              if (verify_cookie) {
                values[verify_cookie.name] = verify_cookie.value;
                var _cookies2 = [];

                for (var _name2 in values) {
                  _cookies2.push(_name2 + '=' + values[_name2]);
                }

                cookie = _cookies2.join('; ');
                if (cookie) Lampa.Storage.set('hdrezka_cookie', cookie);
                if (cookie.indexOf('PHPSESSID=') == -1) cookie = 'PHPSESSID=' + (sid || Utils.randomId(26)) + (cookie ? '; ' + cookie : '');
                var prox_enc3 = prox_enc;
                prox_enc3 += 'param/Cookie=' + encodeURIComponent(cookie) + '/';

                localProxyRequest(host + '/', prox_enc3, function (str) {
                  var json = typeof str === 'string' ? Lampa.Arrays.decodeJson(str, {}) : str;
                  var body = (json && json.body || '').replace(/\n/g, '');
                  var error_form = body.match(/(<div class="error-code">[^<]*<div>[^<]*<\/div>[^<]*<\/div>)\s*(<div class="error-title">[^<]*<\/div>)/);

                  if (error_form) {
                    Lampa.Noty.show(error_form[0]);
                    if (error) error();
                    return;
                  }

                  var verify_form = body.match(/<span>MIRROR<\/span>.*<button type="submit" onclick="\$\.cookie(\([^)]*\))/);

                  if (verify_form) {
                    Lampa.Storage.set('hdrezka_cookie', '');
                    Lampa.Noty.show(Lampa.Lang.translate('hdrezka_unsupported_mirror') + ' HDRezka');
                    if (error) error();
                    return;
                  }

                  var cookieHeaders = hdrezkaCookieHeaders(json);

                  if (cookieHeaders && cookieHeaders.forEach) {
                    cookieHeaders.forEach(function (param) {
                      var parts = param.split(';')[0].split('=');

                      if (parts[0]) {
                        if (parts[1] === 'deleted') delete values[parts[0]];else values[parts[0]] = parts[1] || '';
                      }
                    });
                    sid = values['PHPSESSID'] || sid;
                    delete values['PHPSESSID'];
                    var _cookies3 = [];

                    for (var _name3 in values) {
                      _cookies3.push(_name3 + '=' + values[_name3]);
                    }

                    cookie = _cookies3.join('; ');
                    if (cookie) Lampa.Storage.set('hdrezka_cookie', cookie);
                  }

                  if (success) success();
                }, function (a, c) {
                  if (success) success();
                }, false, {
                  dataType: 'text',
                  headers: headers,
                  returnHeaders: returnHeaders
                });
                return;
              }
            }

            if (success) success();
          }, function (a, c) {
            if (success) success();
          }, false, {
            dataType: 'text',
            headers: headers,
            returnHeaders: returnHeaders
          });
        } else {
          hdrezkaDebug('cookie missing', json);
          if (error) error({
            status: json && json.status || 0,
            responseText: 'Успешный ответ без доступного Set-Cookie'
          }, 'Set-Cookie не найден в ответе');
        }
      }, function (a, c) {
        hdrezkaDebug('login network error', {
          status: a && a.status,
          statusText: a && a.statusText,
          responseText: a && a.responseText,
          error: c,
          proxy: chain.current()
        });
        Lampa.Noty.show(network$3.errorDecode(a, c));
        if (error) error(a, c);
      }, postdata, {
        headers: headers,
        returnHeaders: returnHeaders
      });
    }


    function component(object) {
      var _this = this;

      var network = new Lampa.Reguest();
      var scroll = new Lampa.Scroll({
        mask: true,
        over: true
      });
      var files = new Lampa.Explorer(object);
      var filter = new Lampa.Filter(object);
      var forcedQuality = '';
      var qualityFilter = {
        title: Lampa.Lang.translate('settings_player_quality'),
        subtitle: '',
        items: [],
        stype: 'quality'
      };
      var contextmenu_all = [];

      this.proxy = function (name) {
        return Utils.proxy(name);
      };

      this.fixLink = function (link, referrer) {
        return Utils.fixLink(link, referrer);
      };

      this.fixLinkProtocol = function (link, prefer_http, replace_protocol) {
        return Utils.fixLinkProtocol(link, prefer_http, replace_protocol);
      };

      this.proxyLink = function (link, proxy, proxy_enc, enc) {
        return Utils.proxyLink(link, proxy, proxy_enc, enc);
      };

      this.proxyStream = function (url, name) {
        return url;
      };

      this.processSubs = function (url) {
        return url;
      };

      this.proxyStreamSubs = function (url, name) {
        var srtUrl = this.processSubs(url);
        if (srtUrl !== url) return srtUrl;
        return this.proxyStream(url, name);
      };

      this.checkMyIp = function (onComplite) {
        Utils.checkMyIp(network, onComplite);
      };

      var last;
      var extended;
      var selected_id;
      var filter_translate = {
        season: Lampa.Lang.translate('torrent_serial_season'),
        voice: Lampa.Lang.translate('torrent_parser_voice')
      };
      var source = new hdrezka(_this, object, {});

      scroll.body().addClass('torrent-list');
      scroll.minus(files.render().find('.explorer__files-head'));

      this.create = function () {
        var _this2 = this;

        this.activity.loader(true);

        filter.onSearch = function (value) {
          Lampa.Activity.replace({
            search: value,
            search_date: '',
            clarification: true
          });
        };

        filter.onBack = function () {
          _this2.start();
        };

        filter.onSelect = function (type, a, b) {
          if (type == 'filter') {
            if (a.reset) {
              if (extended) source.reset();else _this2.start();
            } else if (a.stype == 'quality') {
              forcedQuality = b.title;

              _this2.updateQualityFilter();
            } else {
              source.filter(type, a, b);
            }
          }
        };

        filter.render().find('.filter--sort span').text('HDRezka');
        files.appendHead(filter.render());
        files.appendFiles(scroll.render());
        this.search();
        return this.render();
      };

      this.updateQualityFilter = function () {
        var preferably = forcedQuality;

        if (!preferably) {
          preferably = Lampa.Storage.get('video_quality_default', '1080') + 'p';
          if (preferably === '1080p') preferably = '1080p Ultra';
        }

        var items = ['2160p', '1440p', '1080p Ultra', '1080p', '720p', '480p'].map(function (quality, i) {
          return {
            title: quality,
            selected: quality === preferably,
            index: i
          };
        });
        qualityFilter.subtitle = preferably;
        qualityFilter.items = items;
        setTimeout(this.closeFilter, 10);
      };


      this.search = function () {
        this.activity.loader(true);
        this.filter({}, {});
        this.reset();
        this.find();
      };

      this.cleanTitle = function (str) {
        return str.replace(/[\s.,:;’'`!?]+/g, ' ').trim();
      };

      this.kpCleanTitle = function (str) {
        return this.cleanTitle(str).replace(/^[ \/\\]+/, '').replace(/[ \/\\]+$/, '').replace(/\+( *[+\/\\])+/g, '+').replace(/([+\/\\] *)+\+/g, '+').replace(/( *[\/\\]+ *)+/g, '+');
      };

      this.normalizeTitle = function (str) {
        return this.cleanTitle(str.toLowerCase().replace(/[\-\u2010-\u2015\u2E3A\u2E3B\uFE58\uFE63\uFF0D]+/g, '-').replace(/ё/g, 'е'));
      };

      this.equalTitle = function (t1, t2) {
        return typeof t1 === 'string' && typeof t2 === 'string' && this.normalizeTitle(t1) === this.normalizeTitle(t2);
      };

      this.containsTitle = function (str, title) {
        return typeof str === 'string' && typeof title === 'string' && this.normalizeTitle(str).indexOf(this.normalizeTitle(title)) !== -1;
      };

      this.equalAnyTitle = function (strings, titles) {
        var _this3 = this;

        return titles.some(function (title) {
          return title && strings.some(function (str) {
            return str && _this3.equalTitle(str, title);
          });
        });
      };

      this.containsAnyTitle = function (strings, titles) {
        var _this4 = this;

        return titles.some(function (title) {
          return title && strings.some(function (str) {
            return str && _this4.containsTitle(str, title);
          });
        });
      };

      this.uniqueNamesShortText = function (names, limit) {
        var unique = [];
        names.forEach(function (name) {
          if (name && unique.indexOf(name) == -1) unique.push(name);
        });

        if (limit && unique.length > 1) {
          var length = 0;
          var limit_index = -1;
          var last_index = unique.length - 1;
          unique.forEach(function (name, index) {
            length += name.length;
            if (limit_index == -1 && length > limit - (index == last_index ? 0 : 5)) limit_index = index;
            length += 2;
          });

          if (limit_index != -1) {
            unique = unique.splice(0, Math.max(limit_index, 1));
            unique.push('...');
          }
        }

        return unique.join(', ');
      };

      this.decodeHtml = function (html) {
        var text = document.createElement("textarea");
        text.innerHTML = html;
        return text.value;
      };

      this.find = function () {
        _this.extendChoice();
        source.search(object);
      };



      this.parsePlaylist = function (str) {
        var pl = [];

        try {
          if (startsWith(str, '[')) {
            str.substring(1).split(/, *\[/).forEach(function (item) {
              item = item.trim();
              if (endsWith(item, ',')) item = item.substring(0, item.length - 1).trim();
              var label_end = item.indexOf(']');

              if (label_end >= 0) {
                var label = item.substring(0, label_end).trim();

                if (item.charAt(label_end + 1) === '{') {
                  item.substring(label_end + 2).split(/; *\{/).forEach(function (voice_item) {
                    voice_item = voice_item.trim();
                    if (endsWith(voice_item, ';')) voice_item = voice_item.substring(0, voice_item.length - 1).trim();
                    var voice_end = voice_item.indexOf('}');

                    if (voice_end >= 0) {
                      var voice = voice_item.substring(0, voice_end).trim();
                      pl.push({
                        label: label,
                        voice: voice,
                        links: voice_item.substring(voice_end + 1).split(' or ').map(function (link) {
                          return link.trim();
                        }).filter(function (link) {
                          return link;
                        })
                      });
                    }
                  });
                } else {
                  pl.push({
                    label: label,
                    links: item.substring(label_end + 1).split(' or ').map(function (link) {
                      return link.trim();
                    }).filter(function (link) {
                      return link;
                    })
                  });
                }
              }
            });
            pl = pl.filter(function (item) {
              return item.links.length;
            });
          }
        } catch (e) {}

        return pl;
      };

      this.parseM3U = function (str) {
        var pl = [];

        try {
          var xstream = false;
          var bandwidth = 0;
          var width = 0;
          var height = 0;
          var codecs = '';
          str.split('\n').forEach(function (line) {
            line = line.trim();

            if (startsWith(line, '#')) {
              if (startsWith(line, '#EXT-X-STREAM-INF')) {
                xstream = true;
                var BANDWIDTH = line.match(/\bBANDWIDTH=(\d+)\b/);

                if (BANDWIDTH) {
                  bandwidth = BANDWIDTH[1];
                }

                var RESOLUTION = line.match(/\bRESOLUTION=(\d+)x(\d+)\b/);

                if (RESOLUTION) {
                  width = parseInt(RESOLUTION[1]);
                  height = parseInt(RESOLUTION[2]);
                }

                var CODECS = line.match(/\bCODECS="([^"]+)"/);

                if (CODECS) {
                  codecs = CODECS[1];
                }
              }
            } else if (line.length) {
              pl.push({
                xstream: xstream,
                bandwidth: bandwidth,
                width: width,
                height: height,
                codecs: codecs,
                link: line
              });
              xstream = false;
              bandwidth = 0;
              width = 0;
              height = 0;
              codecs = '';
            }
          });
        } catch (e) {}

        return pl;
      };

      this.formatEpisodeTitle = function (s_num, e_num, name) {
        var title = '';
        var full = Lampa.Storage.field('hdrezka_full_episode_title') === true;

        if (s_num != null && s_num !== '') {
          title = (full ? Lampa.Lang.translate('torrent_serial_season') + ' ' : 'S') + s_num + ' / ';
        }

        if (name == null || name === '') name = Lampa.Lang.translate('torrent_serial_episode') + ' ' + e_num;else if (e_num != null && e_num !== '') name = Lampa.Lang.translate('torrent_serial_episode') + ' ' + e_num + ' - ' + name;
        title += name;
        return title;
      };

      this.extendChoice = function () {
        var data = Lampa.Storage.cache('hdrezka_choice', 500, {});
        var save = data[selected_id || object.movie.id] || {};
        extended = true;
        source.extendChoice(save);
      };

      this.saveChoice = function (choice) {
        var data = Lampa.Storage.cache('hdrezka_choice', 500, {});
        data[selected_id || object.movie.id] = choice;
        Lampa.Storage.set('hdrezka_choice', data);
      };


      this.similars = function (json, search_more, more_params) {
        var _this6 = this;

        json.forEach(function (elem) {
          var title = elem.title || elem.ru_title || elem.nameRu || elem.en_title || elem.nameEn || elem.orig_title || elem.nameOriginal;
          var orig_title = elem.orig_title || elem.nameOriginal || elem.en_title || elem.nameEn;
          var year = elem.start_date || elem.year || '';
          var info = [];
          if (orig_title && orig_title != elem.title) info.push(orig_title);
          if (elem.seasons_count) info.push(Lampa.Lang.translate('hdrezka_seasons_count') + ': ' + elem.seasons_count);
          if (elem.episodes_count) info.push(Lampa.Lang.translate('hdrezka_episodes_count') + ': ' + elem.episodes_count);
          elem.title = title;
          elem.quality = year ? (year + '').slice(0, 4) : '----';
          elem.info = info.length ? ' / ' + info.join(' / ') : '';
          var item = Lampa.Template.get('hdrezka_folder', elem);
          item.on('hover:enter', function () {
            _this6.activity.loader(true);

            _this6.reset();

            object.search = elem.title;
            object.search_date = year;
            selected_id = elem.id;

            _this6.extendChoice();

            source.search(object, elem.kp_id || elem.kinopoisk_id || elem.kinopoiskId || elem.filmId || elem.imdb_id, [elem]);
          });

          _this6.append(item);
        });

        if (search_more) {
          var elem = {
            title: Lampa.Lang.translate('hdrezka_show_more'),
            quality: '...',
            info: ''
          };
          var item = Lampa.Template.get('hdrezka_folder', elem);
          item.on('hover:enter', function () {
            _this6.activity.loader(true);

            _this6.reset();

            search_more(more_params);
          });
          this.append(item);
        }
      };


      this.reset = function () {
        contextmenu_all = [];
        last = filter.render().find('.selector').eq(0)[0];
        scroll.render().find('.empty').remove();
        scroll.clear();
        scroll.reset();
      };

      this.inActivity = function () {
        var body = $('body');
        return !(body.hasClass('settings--open') || body.hasClass('menu--open') || body.hasClass('keyboard-input--visible') || body.hasClass('selectbox--open') || body.hasClass('search--open') || body.hasClass('ambience--enable') || $('div.modal').length);
      };


      this.loading = function (status) {
        if (status) this.activity.loader(true);else {
          this.activity.loader(false);
          if (Lampa.Activity.active().activity === this.activity && this.inActivity()) this.activity.toggle();
        }
      };

      this.getDefaultQuality = function (qualityMap, defValue) {
        {
          var needHackHlsLink = function needHackHlsLink(link) {
            return link && endsWith(link, '.m3u8') && link.lastIndexOf('?') <= link.lastIndexOf('/');
          };

          if (qualityMap) {
            for (var ID in qualityMap) {
              if (needHackHlsLink(qualityMap[ID])) {
                qualityMap[ID] += '?';
              }
            }
          }

          if (needHackHlsLink(defValue)) {
            defValue += '?';
          }
        }

        if (qualityMap) {
          var preferably = forcedQuality;

          if (!preferably) {
            preferably = Lampa.Storage.get('video_quality_default', '1080') + 'p';
            if (preferably === '1080p') preferably = '1080p Ultra';
          }

          var items = ['2160p', '2160', '4K', '1440p', '1440', '2K', '1080p Ultra', '1080p', '1080', '720p', '720', '480p', '480', '360p', '360', '240p', '240'];
          var idx = items.indexOf(preferably);

          if (idx !== -1) {
            for (var i = idx; i < items.length; i++) {
              var item = items[i];
              if (qualityMap[item]) return qualityMap[item];
            }

            for (var _i = idx - 1; _i >= 0; _i--) {
              var _item = items[_i];
              if (qualityMap[_item]) return qualityMap[_item];
            }
          }
        }

        return defValue;
      };

      this.renameQualityMap = function (qualityMap) {
        if (!qualityMap) return qualityMap;
        var renamed = {};

        for (var label in qualityMap) {
          renamed["\u200B" + label] = qualityMap[label];
        }

        return renamed;
      };


      this.filter = function (filter_items, choice) {
        var select = [];

        var add = function add(type, title) {
          var need = Lampa.Storage.get('hdrezka_filter', '{}');
          var items = filter_items[type];
          var subitems = [];
          var value = need[type];
          items.forEach(function (name, i) {
            subitems.push({
              title: name,
              selected: value == i,
              index: i
            });
          });
          select.push({
            title: title,
            subtitle: items[value],
            items: subitems,
            stype: type
          });
        };

        Lampa.Storage.set('hdrezka_filter', choice);
        select.push({
          title: Lampa.Lang.translate('torrent_parser_reset'),
          reset: true
        });
        if (filter_items.voice && filter_items.voice.length) add('voice', Lampa.Lang.translate('torrent_parser_voice'));
        if (filter_items.season && filter_items.season.length) add('season', Lampa.Lang.translate('torrent_serial_season'));
        this.updateQualityFilter();
        select.push(qualityFilter);
        filter.set('filter', select);
        filter.set('sort', []);
        this.selected(filter_items);
      };


      this.closeFilter = function () {
        if ($('body').hasClass('selectbox--open')) Lampa.Select.close();
      };


      this.selected = function (filter_items) {
        var need = Lampa.Storage.get('hdrezka_filter', '{}'),
            select = [];

        for (var i in need) {
          if (i !== 'source' && filter_translate[i] && filter_items[i] && filter_items[i].length > 1) {
            select.push(filter_translate[i] + ': ' + filter_items[i][need[i]]);
          }
        }

        filter.chosen('filter', select);
      };


      this.append = function (item) {
        item.on('hover:focus', function (e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        scroll.append(item);
      };


      this.contextmenu = function (params) {
        contextmenu_all.push(params);
        params.item.on('hover:long', function () {
          var enabled = Lampa.Controller.enabled().name;

          function selectQuality(title, callback) {
            return function (extra) {
              if (extra.quality) {
                var qual = [];

                for (var i in extra.quality) {
                  qual.push({
                    title: i,
                    file: extra.quality[i]
                  });
                }

                Lampa.Select.show({
                  title: title,
                  items: qual,
                  onBack: function onBack() {
                    Lampa.Controller.toggle(enabled);
                  },
                  onSelect: callback
                });
              } else callback(null, extra);
            };
          }

          var menu = [{
            title: Lampa.Lang.translate('torrent_parser_label_title'),
            mark: true
          }, {
            title: Lampa.Lang.translate('torrent_parser_label_cancel_title'),
            clearmark: true
          }, {
            title: Lampa.Lang.translate('hdrezka_clearmark_all'),
            clearmark_all: true
          }, {
            title: Lampa.Lang.translate('time_reset'),
            timeclear: true
          }, {
            title: Lampa.Lang.translate('hdrezka_timeclear_all'),
            timeclear_all: true
          }];

          if (Lampa.Platform.is('webos')) {
            menu.push({
              title: Lampa.Lang.translate('player_lauch') + ' - Webos',
              player: 'webos'
            });
          }

          if (Lampa.Platform.is('android')) {
            menu.push({
              title: Lampa.Lang.translate('player_lauch') + ' - Android',
              player: 'android'
            });
          }

          menu.push({
            title: Lampa.Lang.translate('player_lauch') + ' - Lampa',
            player: 'lampa'
          });

          if (params.file) {
            menu.push({
              title: Lampa.Lang.translate('copy_link'),
              copylink: true
            });
          }

          if (Lampa.Account.working() && params.element && typeof params.element.season !== 'undefined' && Lampa.Account.subscribeToTranslation) {
            menu.push({
            title: Lampa.Lang.translate('hdrezka_voice_subscribe'),
              subscribe: true
            });
          }

          Lampa.Select.show({
            title: Lampa.Lang.translate('title_action'),
            items: menu,
            onBack: function onBack() {
              Lampa.Controller.toggle(enabled);
            },
            onSelect: function onSelect(a) {
              if (a.clearmark) {
                Lampa.Arrays.remove(params.viewed, params.hash_file);
                Lampa.Storage.set('online_view', params.viewed);
                params.item.find('.torrent-item__viewed').remove();
              }

              if (a.clearmark_all) {
                contextmenu_all.forEach(function (params) {
                  Lampa.Arrays.remove(params.viewed, params.hash_file);
                  Lampa.Storage.set('online_view', params.viewed);
                  params.item.find('.torrent-item__viewed').remove();
                });
              }

              if (a.mark) {
                if (params.viewed.indexOf(params.hash_file) == -1) {
                  params.viewed.push(params.hash_file);
                  params.item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                  Lampa.Storage.set('online_view', params.viewed);
                }
              }

              if (a.timeclear) {
                params.view.percent = 0;
                params.view.time = 0;
                params.view.duration = 0;
                Lampa.Timeline.update(params.view);
              }

              if (a.timeclear_all) {
                contextmenu_all.forEach(function (params) {
                  params.view.percent = 0;
                  params.view.time = 0;
                  params.view.duration = 0;
                  Lampa.Timeline.update(params.view);
                });
              }

              Lampa.Controller.toggle(enabled);

              if (a.player) {
                Lampa.Player.runas(a.player);
                params.item.trigger('hover:enter', {
                  runas: a.player
                });
              }

              if (a.copylink) {
                params.file(selectQuality('Ссылки', function (b, extra) {
                  Lampa.Utils.copyTextToClipboard(b && b.file || extra && extra.file, function () {
                    Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                  }, function () {
                    Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
                  });
                }));
              }

              if (a.subscribe) {
                Lampa.Account.subscribeToTranslation({
                  card: object.movie,
                  season: params.element.season,
                  episode: params.element.translate_episode_end,
                  voice: params.element.translate_voice
                }, function () {
                  Lampa.Noty.show(Lampa.Lang.translate('hdrezka_voice_success'));
                }, function () {
                  Lampa.Noty.show(Lampa.Lang.translate('hdrezka_voice_error'));
                });
              }
            }
          });
        }).on('hover:focus', function () {
          if (Lampa.Helper) Lampa.Helper.show('online_file', Lampa.Lang.translate('hdrezka_file_helper'), params.item);
        });
      };


      this.empty = function (msg) {
        var empty = Lampa.Template.get('list_empty');
        if (msg) empty.find('.empty__descr').text(msg);
        scroll.append(empty);
        this.loading(false);
      };


      this.emptyForQuery = function (query) {
        this.empty(Lampa.Lang.translate('hdrezka_query_start') + ' (' + query + ') ' + Lampa.Lang.translate('hdrezka_query_end'));
      };

      this.getLastEpisode = function (items) {
        var last_episode = 0;
        items.forEach(function (e) {
          if (typeof e.episode !== 'undefined') last_episode = Math.max(last_episode, parseInt(e.episode));
        });
        return last_episode;
      };


      this.start = function (first_select) {

        if (first_select) {
          var last_views = scroll.render().find('.selector.online').find('.torrent-item__viewed').parent().last();
          if (object.movie.number_of_seasons && last_views.length) last = last_views.eq(0)[0];else last = scroll.render().find('.selector').eq(0)[0];
        }

        Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
        Lampa.Controller.add('content', {
          toggle: function toggle() {
            Lampa.Controller.collectionSet(scroll.render(), files.render());
            Lampa.Controller.collectionFocus(last || false, scroll.render());
          },
          up: function up() {
            if (Navigator.canmove('up')) {
              Navigator.move('up');
            } else Lampa.Controller.toggle('head');
          },
          down: function down() {
            Navigator.move('down');
          },
          right: function right() {
            if (Navigator.canmove('right')) Navigator.move('right');else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
          },
          left: function left() {
            if (Navigator.canmove('left')) Navigator.move('left');else Lampa.Controller.toggle('menu');
          },
          back: this.back
        });
        if (this.inActivity()) Lampa.Controller.toggle('content');
      };

      this.render = function () {
        return files.render();
      };

      this.back = function () {
        Lampa.Activity.backward();
      };

      this.pause = function () {};

      this.stop = function () {};

      this.destroy = function () {
        network.clear();
        files.destroy();
        scroll.destroy();
        network = null;
        source.destroy();
      };
    }


  var Utils = {
    hdrezkaMirror: hdrezkaMirror,
    hdrezkaLocalProxyList: hdrezkaLocalProxyList,
    createHdrezkaLocalProxyChain: createHdrezkaLocalProxyChain,
    hdrezkaLocalProxyConfigError: hdrezkaLocalProxyConfigError,
    requestThroughHdrezkaLocalProxy: requestThroughHdrezkaLocalProxy,
    baseUserAgent: baseUserAgent,
    parseURL: parseURL,
    fixLink: fixLink,
    fixLinkProtocol: fixLinkProtocol,
    proxyLink: proxyLink,
    randomId: randomId,
    proxy: function () { return ''; },
    checkMyIp: function (_, callback) { if (callback) callback(); }
  };

  function initLang() {
    if (!Lampa.Lang || !Lampa.Lang.add) return;
    Lampa.Lang.add({
      hdrezka_title_full: { ru: 'HDRezka', en: 'HDRezka' },
      hdrezka_nolink: { ru: 'Не удалось получить ссылку', en: 'Failed to get link' },
      hdrezka_blockedlink: { ru: 'Видео недоступно', en: 'Video unavailable' },
      hdrezka_authorization_required: { ru: 'Требуется авторизация', en: 'Authorization required' },
      hdrezka_unsupported_mirror: { ru: 'Неподдерживаемое зеркало', en: 'Unsupported mirror' },
      hdrezka_local_proxy_missing_error: { ru: 'HDRezka: настройте хотя бы один телефон Lampa Bridge', en: 'HDRezka: configure at least one Lampa Bridge phone' },
      hdrezka_local_proxy_unavailable_error: { ru: 'HDRezka: локальные прокси недоступны', en: 'HDRezka: local proxies are unavailable' },
      hdrezka_mirror: { ru: 'Зеркало HDRezka', en: 'HDRezka mirror' },
      hdrezka_local_proxy_1: { ru: 'Телефон 1 (Lampa Bridge)', en: 'Phone 1 (Lampa Bridge)' },
      hdrezka_local_proxy_2: { ru: 'Телефон 2 (Lampa Bridge)', en: 'Phone 2 (Lampa Bridge)' },
      hdrezka_local_proxy_3: { ru: 'Телефон 3 (Lampa Bridge)', en: 'Phone 3 (Lampa Bridge)' },
      hdrezka_name: { ru: 'Логин HDRezka', en: 'HDRezka login' },
      hdrezka_password: { ru: 'Пароль HDRezka', en: 'HDRezka password' },
      hdrezka_login: { ru: 'Войти в HDRezka', en: 'Log in to HDRezka' },
      hdrezka_logout: { ru: 'Выйти из HDRezka', en: 'Log out of HDRezka' },
      hdrezka_cookie: { ru: 'Cookie HDRezka', en: 'HDRezka cookie' },
      hdrezka_fill_cookie: { ru: 'Получить cookie', en: 'Get cookie' },
      hdrezka_settings_title: { ru: 'HDRezka', en: 'HDRezka' },
      hdrezka_settings_auth: { ru: 'Авторизация', en: 'Authorization' },
      hdrezka_settings_proxy: { ru: 'Прокси', en: 'Proxy' },
      hdrezka_settings_misc: { ru: 'Разное', en: 'Miscellaneous' },
      hdrezka_reload: { ru: 'Обновить HDRezka', en: 'Reload HDRezka' },
      hdrezka_prefer_http: { ru: 'Предпочитать HTTP для видео', en: 'Prefer HTTP for video' },
      hdrezka_prefer_mp4: { ru: 'Предпочитать MP4', en: 'Prefer MP4' },
      hdrezka_full_episode_title: { ru: 'Показывать полное название серии', en: 'Show full episode title' },
      settings_cub_not_specified: { ru: 'Не задано', en: 'Not specified' },
      settings_player_quality: { ru: 'Качество', en: 'Quality' },
      torrent_parser_voice: { ru: 'Озвучка', en: 'Voice' },
      torrent_parser_season: { ru: 'Сезон', en: 'Season' },
      settings_rest_source: { ru: 'Источник', en: 'Source' },
      hdrezka_seasons_count: { ru: 'Сезонов', en: 'Seasons' },
      hdrezka_episodes_count: { ru: 'Эпизодов', en: 'Episodes' },
      hdrezka_show_more: { ru: 'Показать ещё', en: 'Show more' },
      hdrezka_file_helper: { ru: 'Удерживайте OK для контекстного меню', en: 'Hold OK for context menu' },
      hdrezka_voice_subscribe: { ru: 'Подписаться на перевод', en: 'Subscribe to translation' },
      hdrezka_voice_success: { ru: 'Вы успешно подписались', en: 'Subscribed' },
      hdrezka_voice_error: { ru: 'Возникла ошибка', en: 'An error occurred' }
    });
  }

  function resetTemplates() {
    Lampa.Template.add('hdrezka', '<div class="online selector"><div class="online__body"><div class="online__title">{title}</div><div class="online__quality">{quality}{info}</div></div></div>');
    Lampa.Template.add('hdrezka_folder', '<div class="online selector"><div class="online__body"><div class="online__title">{title}</div><div class="online__quality">{quality}{info}</div></div></div>');
  }

  function hdrezkaMarkMarkup() {
    return '<circle cx="128" cy="128" r="104" fill="none" stroke="currentColor" stroke-width="14"/>' +
      '<path transform="translate(2 1)" fill="currentColor" fill-rule="evenodd" d="M60 84H80V118H104V84H124V172H104V138H80V172H60V84ZM132 84H158C180 84 196 101 196 128C196 155 180 172 158 172H132V84ZM152 102V154H158C169 154 176 145 176 128C176 111 169 102 158 102H152Z"/>';
  }

  function hdrezkaMarkSvg(class_name) {
    return '<svg class="' + (class_name || '') + '" viewBox="0 0 256 256" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
      hdrezkaMarkMarkup() +
      '</svg>';
  }

  function hdrezkaFullLogoSvg(class_name) {
    return '<svg class="' + (class_name || '') + '" viewBox="0 0 760 256" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
      hdrezkaMarkMarkup() +
      '<text x="270" y="180" fill="currentColor" font-family="Arial Rounded MT Bold, Arial Black, Arial, Helvetica, sans-serif" font-size="140" font-weight="700" letter-spacing="-4">REZKA</text>' +
      '</svg>';
  }

  function hdrezkaEnsureStyles() {
    if (typeof document === 'undefined' || document.getElementById('hdrezka-plugin-styles')) return;

    var style = document.createElement('style');
    var css = '';
    css += '.full-start__button.hdrezka-card-button{background:linear-gradient(135deg,#1d8a3a,#0f5e25);color:#fff;border-color:transparent;display:flex;align-items:center;justify-content:center;flex:0 0 8.2em;width:8.2em;min-width:8.2em;max-width:8.2em;height:2.8em;padding:.2em .25em;box-sizing:border-box;overflow:hidden;}';
    css += '.full-start__button.hdrezka-card-button.focus,.full-start__button.hdrezka-card-button:hover{background:linear-gradient(135deg,#2cac52,#167d32);color:#fff;box-shadow:0 0 0 .12em rgba(91,220,121,.7);}';
    css += '.hdrezka-card-button .hdrezka-card-logo{display:block;width:100%;height:100%;min-width:0;flex:0 0 auto;color:#fff;}';
    style.id = 'hdrezka-plugin-styles';
    style.type = 'text/css';
    if (style.styleSheet) style.styleSheet.cssText = css;else style.appendChild(document.createTextNode(css));
    (document.head || document.getElementsByTagName('head')[0] || document.documentElement).appendChild(style);
  }

  function openHdrezkaForMovie(movie) {
    if (!movie) return;
    Lampa.Activity.push({
      url: '',
      title: 'HDRezka',
      component: 'hdrezka',
      search: movie.title,
      search_one: movie.title,
      search_two: movie.original_title,
      movie: movie,
      page: 1
    });
  }

  function addHdrezkaCardButton(event) {
    if (!event || !event.object || !event.object.activity || !event.data || !event.data.movie) return;

    var root = event.object.activity.render();
    if (root.find('.view--hdrezka').length) return;

    hdrezkaEnsureStyles();
    var button = $('<div class="full-start__button selector hdrezka-card-button view--hdrezka">' + hdrezkaFullLogoSvg('hdrezka-card-logo') + '</div>');
    button.on('hover:enter', function () { openHdrezkaForMovie(event.data.movie); });

    var buttons = root.find('.full-start-new__buttons, .full-start__buttons').eq(0);
    if (buttons.length) {
      buttons.prepend(button);
      return;
    }

    var watch = root.find('.view--torrent').eq(0);
    if (watch.length) watch.before(button);
  }

  function initMain() {
    resetTemplates();
    Lampa.Component.add('hdrezka', component);
    Lampa.Listener.follow('full', function (event) {
      if (event.type === 'complite') addHdrezkaCardButton(event);
    });
  }

  function addInput(componentName, name, label) {
    Lampa.SettingsApi.addParam({
      component: componentName,
      param: { name: name, placeholder: Lampa.Lang.translate('settings_cub_not_specified'), type: 'input', values: '', default: '' },
      field: { name: label }
    });
  }

  function addTrigger(componentName, name, label, default_value) {
    Lampa.SettingsApi.addParam({
      component: componentName,
      param: { name: name, type: 'trigger', default: default_value },
      field: { name: label }
    });
  }

  function addButton(componentName, name, label, onChange) {
    Lampa.SettingsApi.addParam({
      component: componentName,
      param: { name: name, type: 'button' },
      field: { name: label },
      onChange: onChange
    });
  }

  function addSettingsGroup(componentName, title) {
    if (Lampa.SettingsApi.getComponent(componentName)) return false;
    Lampa.SettingsApi.addComponent({
      component: componentName,
      icon: hdrezkaMarkSvg('hdrezka-settings-logo'),
      name: title
    });
    return true;
  }

  function addSettingsFolder(parentComponent, childComponent, title) {
    Lampa.SettingsApi.addParam({
      component: parentComponent,
      param: { name: childComponent + '_open', type: 'button' },
      field: {
        name: '<div class="settings-folder" style="padding:0!important"><div style="font-size:1.3em">' + title + '</div></div>'
      },
      onChange: function () {
        Lampa.Settings.create(childComponent, {
          onBack: function () { Lampa.Settings.create(parentComponent); }
        });
      }
    });
  }

  function hideHdrezkaChildSettings(body) {
    if (typeof $ === 'undefined' || !body) return;
    $('[data-component="hdrezka_auth_settings"], [data-component="hdrezka_proxy_settings"], [data-component="hdrezka_misc_settings"]', body).hide();
  }

  function initSettings() {
    var rootComponent = 'hdrezka_settings';
    var authComponent = 'hdrezka_auth_settings';
    var proxyComponent = 'hdrezka_proxy_settings';
    var miscComponent = 'hdrezka_misc_settings';

    if (addSettingsGroup(rootComponent, Lampa.Lang.translate('hdrezka_settings_title'))) {
      addSettingsFolder(rootComponent, authComponent, Lampa.Lang.translate('hdrezka_settings_auth'));
      addSettingsFolder(rootComponent, proxyComponent, Lampa.Lang.translate('hdrezka_settings_proxy'));
      addSettingsFolder(rootComponent, miscComponent, Lampa.Lang.translate('hdrezka_settings_misc'));
      addButton(rootComponent, 'hdrezka_reload', Lampa.Lang.translate('hdrezka_reload'), function () {
        if (window.location && typeof window.location.reload === 'function') window.location.reload(true);
      });
    }

    if (addSettingsGroup(authComponent, Lampa.Lang.translate('hdrezka_settings_auth'))) {
      addInput(authComponent, 'hdrezka_name', Lampa.Lang.translate('hdrezka_name'));
      addInput(authComponent, 'hdrezka_password', Lampa.Lang.translate('hdrezka_password'));
      addButton(authComponent, 'hdrezka_login', Lampa.Lang.translate('hdrezka_login'), function () {
        hdrezkaLogin(function () { Lampa.Noty.show('HDRezka: вход выполнен'); }, function (a, c) { Lampa.Noty.show('HDRezka: вход не выполнен' + (c ? ': ' + c : '')); });
      });
      addButton(authComponent, 'hdrezka_logout', Lampa.Lang.translate('hdrezka_logout'), function () {
        hdrezkaLogout(function () { Lampa.Noty.show('HDRezka: выход выполнен'); }, function () { Lampa.Noty.show('HDRezka: локальные cookies очищены'); });
      });
      addButton(authComponent, 'hdrezka_fill_cookie', Lampa.Lang.translate('hdrezka_fill_cookie'), function () {
        hdrezkaFillCookie(function () { Lampa.Noty.show('HDRezka: cookie получен'); }, function () { Lampa.Noty.show('HDRezka: cookie получить не удалось'); });
      });
      addInput(authComponent, 'hdrezka_cookie', Lampa.Lang.translate('hdrezka_cookie'));
    }

    if (addSettingsGroup(proxyComponent, Lampa.Lang.translate('hdrezka_settings_proxy'))) {
      addInput(proxyComponent, 'hdrezka_mirror', Lampa.Lang.translate('hdrezka_mirror'));
      addInput(proxyComponent, 'hdrezka_local_proxy_1', Lampa.Lang.translate('hdrezka_local_proxy_1'));
      addInput(proxyComponent, 'hdrezka_local_proxy_2', Lampa.Lang.translate('hdrezka_local_proxy_2'));
      addInput(proxyComponent, 'hdrezka_local_proxy_3', Lampa.Lang.translate('hdrezka_local_proxy_3'));
    }

    if (addSettingsGroup(miscComponent, Lampa.Lang.translate('hdrezka_settings_misc'))) {
      addTrigger(miscComponent, 'hdrezka_prefer_http', Lampa.Lang.translate('hdrezka_prefer_http'), window.location.protocol !== 'https:');
      addTrigger(miscComponent, 'hdrezka_prefer_mp4', Lampa.Lang.translate('hdrezka_prefer_mp4'), true);
      addTrigger(miscComponent, 'hdrezka_full_episode_title', Lampa.Lang.translate('hdrezka_full_episode_title'), false);
    }

    if (Lampa.Settings && Lampa.Settings.listener && Lampa.Settings.listener.follow) {
      Lampa.Settings.listener.follow('open', function (event) {
        if (event && event.name === 'main') hideHdrezkaChildSettings(event.body);
      });
    }
  }

  function startPlugin() {
    initLang();
    initMain();
    initSettings();
  }

  startPlugin();
})();
