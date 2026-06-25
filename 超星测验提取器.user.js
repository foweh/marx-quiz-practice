// ==UserScript==
// @name         超星测验提取器
// @namespace    https://github.com/chaoxing-quiz-extractor
// @version      1.2
// @description  从超星学习通学生页面抓取所有随堂测验题目，合并生成交互式练习 HTML
// @author       Chaoxing Quiz Extractor
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy?*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      mooc1.chaoxing.com
// @connect      mooc2-ans.chaoxing.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 全局状态 =====================
  const HOST = 'https://mooc1.chaoxing.com';
  const HOST_ANS = 'https://mooc2-ans.chaoxing.com';

  let courseId = '';
  let classId = '';
  let cpi = '';
  let courseName = '';

  // 收集的测验数据 [{ chapterTitle, chapterPath, quizzes: [{ title, knowledgeId, questions }] }]
  let allChapters = [];
  let totalQuestions = 0;
  let totalWithAnswers = 0;
  let totalQuizzes = 0;
  let scanDone = false;

  // ===================== DOM 工具 =====================
  function $el(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    if (typeof children === 'string') el.innerHTML = children;
    else if (children) children.forEach(c => el.appendChild(c));
    return el;
  }

  // ===================== UI 面板 =====================
  function injectUI() {
    // 移除已有面板
    const existing = document.getElementById('cxr-panel-v2');
    if (existing) existing.remove();

    const panel = $el('div', { id: 'cxr-panel-v2', style: 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif' });

    const fab = $el('div', { id: 'cxrFabV2', class: 'cxr-fab', title: '测验导出' }, '📋');
    Object.assign(fab.style, {
      width: '52px', height: '52px', borderRadius: '50%', background: '#4f46e5',
      color: '#fff', border: 'none', cursor: 'pointer', fontSize: '22px',
      boxShadow: '0 4px 16px rgba(79,70,229,.35)', transition: 'all .2s',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const card = $el('div', { id: 'cxrCardV2', style: 'display:none;position:absolute;bottom:64px;right:0;width:320px;background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.16);padding:20px;max-height:520px;overflow-y:auto' });

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:15px;font-weight:700;color:#1a1a2e">📦 测验提取器</span>
        <button id="cxrCloseV2" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;padding:2px 6px">&times;</button>
      </div>
      <div id="cxrInfoV2" style="font-size:12px;color:#6b7280;margin-bottom:12px;line-height:1.6"></div>
      <div id="cxrBarWrapV2" style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:8px;display:none">
        <div id="cxrFillV2" style="height:100%;background:linear-gradient(90deg,#4f46e5,#818cf8);width:0%;transition:width .3s;border-radius:3px"></div>
      </div>
      <button id="cxrGoV2" class="cxr-btn-v2" style="display:block;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#4f46e5;color:#fff;margin-bottom:8px">🔍 扫描章节</button>
      <button id="cxrFetchV2" class="cxr-btn-v2" style="display:none;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#059669;color:#fff;margin-bottom:8px">📥 开始抓取题目</button>
      <button id="cxrDownloadV2" class="cxr-btn-v2" style="display:none;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#ea580c;color:#fff">⬇ 下载练习 HTML</button>
      <div id="cxrLogV2" style="display:none;max-height:160px;overflow-y:auto;font-size:11px;color:#6b7280;line-height:1.6;margin-top:8px;background:#f9fafb;border-radius:8px;padding:8px"></div>
    `;

    panel.appendChild(fab);
    panel.appendChild(card);
    document.body.appendChild(panel);

    // 事件绑定
    let open = false;
    fab.addEventListener('click', () => {
      open = !open;
      card.style.display = open ? 'block' : 'none';
      if (open) updateInfo();
    });
    document.getElementById('cxrCloseV2').addEventListener('click', () => {
      open = false;
      card.style.display = 'none';
    });

    document.getElementById('cxrGoV2').addEventListener('click', scanChapters);
    document.getElementById('cxrFetchV2').addEventListener('click', fetchAllQuizzes);
    document.getElementById('cxrDownloadV2').addEventListener('click', downloadHTML);

    // Hover effect on fab
    fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.08)'; });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });

    return { fab, card };
  }

  function updateInfo() {
    const info = document.getElementById('cxrInfoV2');
    if (scanDone) {
      info.innerHTML = `📂 课程: <b>${escHtml(courseName)}</b><br>📝 测验: <b>${totalQuizzes}</b> 个 | 总题数: <b>${totalQuestions}</b> | 有答案: <b>${totalWithAnswers}</b>`;
    } else if (allChapters.length > 0) {
      info.innerHTML = `🔍 已扫描到 <b>${totalQuizzes}</b> 个测验<br>点击「开始抓取题目」获取详情`;
    } else {
      info.innerHTML = '点击「扫描章节」开始分析页面结构';
    }
  }

  function log(msg, isError) {
    const logDiv = document.getElementById('cxrLogV2');
    logDiv.style.display = 'block';
    const div = document.createElement('div');
    div.textContent = msg;
    if (isError) div.style.color = '#dc2626';
    logDiv.appendChild(div);
    logDiv.scrollTop = logDiv.scrollHeight;
  }

  function setProgress(pct) {
    const bar = document.getElementById('cxrBarWrapV2');
    const fill = document.getElementById('cxrFillV2');
    bar.style.display = 'block';
    fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ===================== 章节扫描 =====================
  function scanChapters() {
    allChapters = [];
    totalQuestions = 0;
    totalWithAnswers = 0;
    totalQuizzes = 0;

    log('🚀 开始扫描章节...');
    document.getElementById('cxrGoV2').textContent = '⏳ 扫描中...';
    document.getElementById('cxrGoV2').disabled = true;
    document.getElementById('cxrBarWrapV2').style.display = 'block';
    document.getElementById('cxrFillV2').style.width = '0%';

    // 从页面中提取 courseId, classId, cpi (多重 fallback)
    // 方法1: 从 script 标签中提取
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (!cpi) { const m = txt.match(/var\s+stu_cpi\s*=\s*["'](\d+)["']/); if (m) cpi = m[1]; }
      if (!classId) { const m = txt.match(/var\s+stu_clazzId\s*=\s*["'](\d+)["']/); if (m) classId = m[1]; }
      if (!courseId) { const m = txt.match(/var\s+stu_CourseId\s*=\s*["'](\d+)["']/); if (m) courseId = m[1]; }
    }
    // 方法2: 从 URL 参数提取
    const urlParams = new URLSearchParams(location.search);
    if (!cpi) cpi = urlParams.get('cpi') || '';
    if (!classId) classId = urlParams.get('clazzid') || urlParams.get('classId') || '';
    if (!courseId) courseId = urlParams.get('courseId') || urlParams.get('courseid') || '';
    // 方法3: 从全局变量
    if (!cpi && typeof window._cpi !== 'undefined') cpi = String(window._cpi);

    // 获取课程名称
    const titleEl = document.querySelector('.courseName') || document.querySelector('title');
    if (titleEl) courseName = titleEl.textContent.replace(/^\s+|\s+$/g, '').replace(/\n/g, ' ').substring(0, 60);

    // 扫描所有章节节点
    const catalogItems = document.querySelectorAll('.posCatalog_name');
    const chapters = [];
    let chapterStack = [{ title: '根', level: 0 }];

    catalogItems.forEach(el => {
      const onclick = (el.getAttribute('onclick') || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const match = onclick.match(/getTeacherAjax\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/);
      if (!match) return;

      const cId = match[1];
      const clId = match[2];
      const kId = match[3];
      const title = (el.getAttribute('title') || el.textContent || '').trim();
      const sbar = el.querySelector('.posCatalog_sbar');
      const sectionNum = sbar ? sbar.textContent.trim() : '';

      // 确认是测验节点（标题含测验关键词）
      if (/测验|测试|考试|作业/.test(title)) {
        chapters.push({
          sectionNum,
          chapterTitle: title,
          knowledgeId: kId,
          courseId: cId,
          classId: clId,
          chapterPath: sectionNum + ' ' + title
        });
      }
    });

    totalQuizzes = chapters.length;
    allChapters = chapters.map(c => ({
      ...c,
      quizzes: [{ title: c.chapterTitle, knowledgeId: c.knowledgeId, questions: [], hasAnswers: null, fetched: false }]
    }));

    log(`✅ 扫描完成: ${totalQuizzes} 个测验节点`);
    updateInfo();

    document.getElementById('cxrGoV2').textContent = '🔄 重新扫描';
    document.getElementById('cxrGoV2').disabled = false;
    document.getElementById('cxrFetchV2').style.display = 'block';
    document.getElementById('cxrBarWrapV2').style.display = 'none';
    scanDone = true;

    if (totalQuizzes === 0) {
      log('⚠️ 未找到测验节点，请确认在正确的页面上', true);
    }
  }

  // ===================== API 请求 =====================
  function gmFetch(url, timeout) {
    return new Promise((resolve, reject) => {
      const fullUrl = url.startsWith('http') ? url : HOST + url;
      GM_xmlhttpRequest({
        method: 'GET',
        url: fullUrl,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        },
        timeout: timeout || 15000,
        onload: function (resp) {
          if (resp.status >= 200 && resp.status < 400) {
            resolve({ html: resp.responseText, finalUrl: resp.finalUrl || fullUrl, status: resp.status });
          } else {
            reject(new Error(`HTTP ${resp.status}`));
          }
        },
        onerror: function (e) { reject(new Error('Network error: ' + (e.error || 'unknown'))); },
        ontimeout: function () { reject(new Error('Timeout')); }
      });
    });
  }

  // 第1步: 获取 cards 页, 提取 mArg 中的 attachment 数据
  async function fetchCardsPage(knowledgeId) {
    const url = `/mooc-ans/knowledge/cards?clazzid=${classId}&courseid=${courseId}&knowledgeid=${knowledgeId}&num=0&ut=s&cpi=${cpi}&mooc2=1&isMicroCourse=false&editorPreview=0`;
    const resp = await gmFetch(url);
    return resp.html;
  }

  function parseMAttachments(html) {
    // 提取 mArg JSON
    const m = html.match(/mArg\s*=\s*({[\s\S]*?});/);
    if (!m) return null;
    try {
      const mArg = JSON.parse(m[1]);
      const attachments = (mArg.attachments || []).filter(a => a.type === 'workid' && a.property && a.property.workid);
      return {
        attachments,
        defaults: mArg.defaults || {},
        knowledgename: mArg.knowledgename || ''
      };
    } catch (e) {
      return null;
    }
  }

  // 第2步: 获取 work 页面 (可能重定向到已批阅页面)
  async function fetchWorkPage(workid, jobid, enc, knowledgeId, ktoken) {
    const url = `/mooc-ans/api/work?api=1&workId=${workid}&jobid=${jobid}&originJobId=${jobid}&needRedirect=true&skipHeader=true&knowledgeid=${knowledgeId}&ktoken=${ktoken}&cpi=${cpi}&ut=s&clazzId=${classId}&mooc2=1&courseid=${courseId}&enc=${enc}`;
    const resp = await gmFetch(url);
    return resp;
  }

  // ===================== HTML 解析 =====================
  function parseQuestionsFromHTML(html) {
    // 使用 DOMParser 解析
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const questions = [];

    // 查找题目容器
    const qDivs = doc.querySelectorAll('.TiMu.newTiMu');
    if (qDivs.length === 0) {
      // 尝试其他选择器
      const altDivs = doc.querySelectorAll('.TiMu');
      if (altDivs.length === 0) return { questions: [], hasAnswers: false };
    }

    (qDivs.length ? qDivs : doc.querySelectorAll('.TiMu')).forEach((div, idx) => {
      const q = { id: idx + 1 };

      // 题型识别
      if (div.classList.contains('singleQuesId')) q.type = '单选题';
      else if (div.classList.contains('multiQuesId')) q.type = '多选题';
      else if (div.classList.contains('trueOrFalseQuesId')) q.type = '判断题';
      else if (div.classList.contains('inputQuesId') || div.querySelector('.Zy_ulTk')) q.type = '填空题';
      else if (div.querySelector('.matching')) q.type = '连线题';
      else if (div.querySelector('.newSort')) q.type = '排序题';
      else q.type = '未知题型';

      // 题干
      const typeSpan = div.querySelector('.newZy_TItle');
      const textEl = div.querySelector('.qtContent p') || div.querySelector('.qtContent');
      if (textEl) {
        q.text = textEl.textContent.replace(/\s+/g, ' ').trim();
      } else {
        const titleDiv = div.querySelector('.Zy_TItle');
        q.text = titleDiv ? titleDiv.textContent.replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim() : '';
      }

      // 选项 (单选题/多选题/判断题)
      const optionEls = div.querySelectorAll('.Zy_ulTop li');
      if (optionEls.length > 0) {
        q.options = [];
        optionEls.forEach(li => {
          const labelEl = li.querySelector('i');
          const contentEl = li.querySelector('a p') || li.querySelector('a') || li;
          const label = labelEl ? labelEl.textContent.replace(/[、,，\s]$/, '').trim() : '';
          const text = contentEl ? contentEl.textContent.replace(/\s+/g, ' ').trim() : '';
          if (label || text) q.options.push({ label, text: text || label });
        });
      }

      // 填空题处理
      if (q.type === '填空题') {
        const tkInputs = div.querySelectorAll('.Zy_ulTk input, .Zy_ulTk textarea, .InpDIV input');
        if (tkInputs.length > 0) {
          q.blankCount = tkInputs.length;
        }
      }

      // 正确答案
      const correctDiv = div.querySelector('.correctAnswer .answerCon');
      const myAnswerDiv = div.querySelector('.myAnswer .answerCon');

      if (correctDiv) {
        q.answer = correctDiv.textContent.replace(/\s+/g, ' ').trim();
        q.hasAnswer = true;
      } else if (myAnswerDiv) {
        q.myAnswer = myAnswerDiv.textContent.replace(/\s+/g, ' ').trim();
        q.hasAnswer = false;
        q.answer = '';
      } else {
        q.hasAnswer = false;
        q.answer = '';
      }

      // 解析 / 知识点
      const kpDiv = div.querySelector('.knowledgePointBx');
      if (kpDiv) {
        const kpLinks = kpDiv.querySelectorAll('.knowledgeList li a');
        if (kpLinks.length > 0) {
          q.knowledge = Array.from(kpLinks).map(a => a.textContent.trim()).filter(Boolean).join(' | ');
        }
      }

      // 分数
      const scoreEl = div.querySelector('.scoreNum');
      if (scoreEl) {
        q.score = scoreEl.textContent.trim();
      }

      // 对错标记
      const markingEl = div.querySelector('.marking_dui, .marking_cuo, .marking_bandui');
      if (markingEl) {
        if (markingEl.classList.contains('marking_dui')) q.isCorrect = true;
        else if (markingEl.classList.contains('marking_cuo')) q.isCorrect = false;
      }

      questions.push(q);
    });

    // 判断是否有正确答案
    const hasAnswers = questions.some(q => q.hasAnswer);
    return { questions, hasAnswers };
  }

  // ===================== 主抓取流程 =====================
  async function fetchAllQuizzes() {
    if (allChapters.length === 0) {
      log('⚠️ 请先扫描章节', true);
      return;
    }

    totalQuestions = 0;
    totalWithAnswers = 0;
    document.getElementById('cxrFetchV2').disabled = true;
    document.getElementById('cxrFetchV2').textContent = '⏳ 抓取中...';
    document.getElementById('cxrLogV2').style.display = 'block';
    log('📥 开始抓取题目数据...');

    const total = allChapters.length;
    let completed = 0;

    for (const chapter of allChapters) {
      const quiz = chapter.quizzes[0];
      if (!quiz || quiz.fetched) {
        completed++;
        continue;
      }

      try {
        log(`  🔍 [${chapter.sectionNum}] ${chapter.chapterTitle}`);

        // Step 1: 获取 cards 页面
        const cardsHtml = await fetchCardsPage(quiz.knowledgeId);
        const mData = parseMAttachments(cardsHtml);

        if (!mData || mData.attachments.length === 0) {
          log(`    ⚠️ 无测验数据`, true);
          quiz.fetched = true;
          quiz.hasAnswers = false;
          chapter.chapterTitle = chapter.sectionNum + ' ' + chapter.chapterTitle;
          completed++;
          setProgress((completed / total) * 100);
          continue;
        }

        // 收集此章节下所有 work 的题目
        let chapterQuestions = [];
        let chapterHasAnswers = false;

        for (const att of mData.attachments) {
          try {
            const workid = att.property.workid;
            const jobid = att.property.jobid || att.jobid;
            const enc = att.enc || '';
            const ktoken = (mData.defaults && mData.defaults.ktoken) || '';

            // Step 2: 获取 work 页面
            const workResp = await fetchWorkPage(workid, jobid, enc, quiz.knowledgeId, ktoken);

            // Step 3: 解析题目
            const result = parseQuestionsFromHTML(workResp.html);

            if (result.questions.length > 0) {
              chapterQuestions = chapterQuestions.concat(result.questions);
              if (result.hasAnswers) chapterHasAnswers = true;
            }
          } catch (e) {
            log(`    ⚠️ 子测验请求失败: ${e.message}`, true);
          }
        }

        quiz.questions = chapterQuestions;
        quiz.hasAnswers = chapterHasAnswers;
        quiz.fetched = true;
        quiz.title = mData.attachments[0] && mData.attachments[0].property.title ?
          mData.attachments[0].property.title : chapter.chapterTitle;

        if (chapterQuestions.length > 0) {
          const ansCount = chapterQuestions.filter(q => q.hasAnswer).length;
          totalQuestions += chapterQuestions.length;
          totalWithAnswers += ansCount;
          log(`    ✅ ${chapterQuestions.length} 题 (${ansCount} 有答案) [${quiz.title}]`);
        } else {
          log(`    📭 无题目`, true);
        }

      } catch (e) {
        log(`    ❌ 抓取失败: ${e.message}`, true);
        quiz.fetched = true;
        quiz.hasAnswers = false;
      }

      completed++;
      setProgress((completed / total) * 100);

      // 请求间延迟避免限流
      await sleep(300 + Math.random() * 400);
    }

    document.getElementById('cxrFetchV2').disabled = false;
    document.getElementById('cxrFetchV2').textContent = '🔄 重新抓取';
    document.getElementById('cxrDownloadV2').style.display = 'block';
    document.getElementById('cxrBarWrapV2').style.display = 'none';
    scanDone = true;
    updateInfo();
    log(`🎉 抓取完成! ${totalQuestions} 题, ${totalWithAnswers} 有答案`);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ===================== HTML 生成（v3: 单题模式 + 双模式 + 错题本 + 成绩记录） =====================
  function generatePracticeHTML() {
    const chaptersWithQuestions = allChapters.filter(c =>
      c.quizzes[0] && c.quizzes[0].questions && c.quizzes[0].questions.length > 0
    );

    if (chaptersWithQuestions.length === 0) {
      alert('没有可导出的题目，请先抓取数据');
      return '';
    }

    let globalId = 0;
    const allQ = [];
    const sections = [];

    chaptersWithQuestions.forEach(ch => {
      const qq = ch.quizzes[0].questions;
      const sectionQuestions = qq.map(q => {
        globalId++;
        return {
          ...q,
          globalId,
          sectionTitle: ch.quizzes[0].title || ch.chapterTitle,
          sectionPath: ch.chapterTitle,
          hasAnswer: q.hasAnswer || false
        };
      });
      sections.push({
        title: ch.quizzes[0].title || ch.chapterTitle,
        path: ch.chapterTitle,
        questions: sectionQuestions,
        hasAnswers: ch.quizzes[0].hasAnswers
      });
      allQ.push(...sectionQuestions);
    });

    const total = allQ.length;
    const withAns = allQ.filter(q => q.hasAnswer).length;

    const questionsJSON = JSON.stringify(allQ.map(q => ({
      id: q.globalId,
      type: q.type,
      text: q.text,
      options: q.options || [],
      answer: q.answer || '',
      hasAnswer: q.hasAnswer,
      knowledge: q.knowledge || '',
      sectionTitle: q.sectionTitle,
      sectionPath: q.sectionPath,
      blankCount: q.blankCount || 0
    })));

    const sectionsJSON = JSON.stringify(sections.map(s => ({
      title: s.title,
      path: s.path,
      hasAnswers: s.hasAnswers,
      questionIds: s.questions.map(q => q.globalId)
    })));

    const labelsStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>练习 - ${escHtml(courseName)}</title>
<style>
:root{--bg:#f0f2f5;--card:#fff;--txt:#1a1a2e;--t2:#6b7280;--pri:#4f46e5;--ok:#059669;--err:#dc2626;--warn:#d97706;--brd:#e5e7eb;--hover:#f3f4f6;--sh:0 2px 8px rgba(0,0,0,.06)}
.dark{--bg:#111827;--card:#1f2937;--txt:#f9fafb;--t2:#9ca3af;--pri:#818cf8;--ok:#34d399;--err:#f87171;--warn:#fbbf24;--brd:#374151;--hover:#374151;--sh:0 2px 8px rgba(0,0,0,.3)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--txt);min-height:100vh;padding:16px}
.container{max-width:720px;margin:0 auto}

.topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.topbar h1{font-size:20px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
.meta{font-size:12px;color:var(--t2)}

.mode-tabs{display:flex;gap:4px;background:var(--card);border-radius:10px;padding:4px;margin-bottom:12px;box-shadow:var(--sh)}
.mode-tab{flex:1;padding:9px 12px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:transparent;color:var(--t2);transition:all .15s;text-align:center}
.mode-tab.active{background:var(--pri);color:#fff}
.mode-tab:hover:not(.active){background:var(--hover)}

.subbar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
.subbar select,.subbar button{padding:7px 12px;border-radius:8px;font-size:13px;border:1px solid var(--brd);background:var(--card);color:var(--txt);cursor:pointer}
.subbar select{min-width:140px}
.subbar button{font-weight:600}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600;transition:all .12s}
.btn-sm:active{transform:scale(.96)}
.btn-pri{background:var(--pri);color:#fff}
.btn-out{background:transparent;color:var(--pri);border:1px solid var(--pri)}
.btn-warn{background:var(--warn);color:#fff}
.btn-err{background:var(--err);color:#fff}

.progress-wrap{margin-bottom:14px}
.progress-bar{height:4px;background:var(--brd);border-radius:2px;overflow:hidden}
.progress-fill{height:100%;background:var(--pri);transition:width .3s;border-radius:2px}
.progress-info{display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-top:4px}

.qgrid{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;max-height:120px;overflow-y:auto;padding:4px}
.qgrid-item{width:30px;height:30px;border-radius:6px;border:1px solid var(--brd);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;cursor:pointer;background:var(--card);color:var(--txt);transition:all .12s}
.qgrid-item.current{border-color:var(--pri);background:#eef2ff;color:var(--pri)}
.dark .qgrid-item.current{background:#312e81}
.qgrid-item.answered{background:#d1fae5;border-color:var(--ok);color:#065f46}
.dark .qgrid-item.answered{background:#064e3b;color:#6ee7b7}
.qgrid-item.wrong-mark{background:#fee2e2;border-color:var(--err);color:#991b1b}
.dark .qgrid-item.wrong-mark{background:#7f1d1d;color:#fca5a5}
.qgrid-item:hover{transform:scale(1.1)}

.card{background:var(--card);border-radius:12px;padding:22px 20px;margin-bottom:14px;box-shadow:var(--sh);min-height:180px}
.q-head{display:flex;align-items:baseline;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.q-num{background:var(--pri);color:#fff;min-width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
.q-type{font-size:11px;color:var(--pri);background:#eef2ff;padding:2px 8px;border-radius:4px;font-weight:600}
.dark .q-type{background:#312e81;color:#a5b4fc}
.no-ans-tag{font-size:10px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;margin-left:4px;vertical-align:middle}
.dark .no-ans-tag{background:#78350f;color:#fcd34d}
.q-text{font-size:16px;line-height:1.65;font-weight:500}
.q-knowledge{font-size:12px;color:var(--t2);margin-top:8px;font-style:italic}

.options{display:flex;flex-direction:column;gap:8px;margin:10px 0}
.opt{display:flex;align-items:flex-start;padding:10px 14px;border:2px solid var(--brd);border-radius:10px;cursor:pointer;transition:all .12s;font-size:15px;line-height:1.5}
.opt:hover:not(.done){border-color:var(--pri);background:var(--hover)}
.opt .o-label{font-weight:700;color:var(--t2);margin-right:10px;min-width:22px;flex-shrink:0}
.opt.selected:not(.done){border-color:var(--pri);background:#eef2ff}
.dark .opt.selected:not(.done){background:#312e81}
.opt.correct{border-color:var(--ok);background:#d1fae5}
.dark .opt.correct{background:#064e3b}
.opt.wrong{border-color:var(--err);background:#fee2e2}
.dark .opt.wrong{background:#7f1d1d}
.opt.done{cursor:default}

.fill-input{width:100%;padding:10px 14px;border:2px solid var(--brd);border-radius:8px;font-size:15px;background:var(--card);color:var(--txt);outline:none;transition:border-color .15s}
.fill-input:focus{border-color:var(--pri)}

.result{margin-top:10px;padding:10px 14px;border-radius:8px;font-size:14px;display:none;line-height:1.5}
.result.show{display:block}
.result.ok{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.result.err{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
.result.info{background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe}
.dark .result.ok{background:#064e3b;color:#6ee7b7;border-color:#059669}
.dark .result.err{background:#7f1d1d;color:#fca5a5;border-color:#dc2626}
.dark .result.info{background:#1e3a5f;color:#93c5fd;border-color:#3b82f6}

.nav-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.nav-btn{padding:9px 20px;border:2px solid var(--brd);border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:var(--card);color:var(--txt);transition:all .15s}
.nav-btn:hover{border-color:var(--pri);color:var(--pri)}
.nav-btn:disabled{opacity:.35;cursor:not-allowed}
.current-indicator{font-size:14px;font-weight:600;color:var(--pri);white-space:nowrap}

.big-btn{display:block;width:100%;padding:13px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;text-align:center;transition:all .15s;margin:6px 0}
.big-btn:active{transform:scale(.98)}
.btn-submit{background:var(--pri);color:#fff}
.btn-view{background:var(--warn);color:#fff}
.btn-retry{background:var(--ok);color:#fff}

.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:none;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:var(--card);border-radius:14px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)}
.modal h3{font-size:18px;margin-bottom:12px}
.modal-close{float:right;background:none;border:none;font-size:20px;cursor:pointer;color:var(--t2)}
.modal table{width:100%;border-collapse:collapse;font-size:13px}
.modal td,.modal th{padding:8px 10px;text-align:left;border-bottom:1px solid var(--brd)}
.modal th{color:var(--t2);font-weight:600}

@media(max-width:500px){
  body{padding:8px}
  .topbar h1{font-size:17px;max-width:200px}
  .card{padding:16px 12px}
  .q-text{font-size:15px}
  .opt{font-size:14px;padding:8px 10px}
  .nav-btn{padding:7px 14px;font-size:13px}
  .qgrid-item{width:26px;height:26px;font-size:11px}
  .mode-tab{font-size:12px;padding:7px 8px}
}
</style>
</head>
<body>
<div class="container">
<div class="topbar">
  <h1>📝 ${escHtml(courseName)}</h1>
  <span class="meta">${total}题 · ${withAns}有答案</span>
</div>

<div class="mode-tabs">
  <button class="mode-tab active" data-mode="practice">📖 练习模式</button>
  <button class="mode-tab" data-mode="exam">📝 考试模式</button>
  <button class="mode-tab" id="btnWrongBook">📕 错题本 <span id="wrongCount"></span></button>
  <button class="mode-tab" id="btnScores">📊 成绩</button>
</div>

<div class="subbar">
  <select id="sectionFilter"><option value="all">📂 全部章节</option></select>
  <button id="btnToggleDark" class="btn-sm btn-out" title="暗色模式">🌓</button>
  <button id="btnReset" class="btn-sm btn-out">🔄 重置当前</button>
  <button id="btnClearWrong" class="btn-sm btn-err" style="display:none">🗑 清空错题本</button>
</div>

<div class="progress-wrap">
  <div class="progress-bar"><div class="progress-fill" id="progFill" style="width:0%"></div></div>
  <div class="progress-info">
    <span id="progLabel">第 1 / ${total} 题</span>
    <span id="ansCount">已答: 0</span>
  </div>
</div>

<div class="qgrid" id="qGrid"></div>

<div class="card" id="qCard"></div>

<div id="actionArea" style="margin-bottom:12px"></div>

<div class="nav-row">
  <button class="nav-btn" id="btnPrev">← 上一题</button>
  <span class="current-indicator" id="curIndicator"></span>
  <button class="nav-btn" id="btnNext">下一题 →</button>
</div>
</div>

<div class="modal-overlay" id="wrongBookModal">
  <div class="modal">
    <button class="modal-close" id="closeWrongBook">&times;</button>
    <h3>📕 错题本</h3>
    <div id="wrongBookContent"></div>
  </div>
</div>

<div class="modal-overlay" id="scoresModal">
  <div class="modal">
    <button class="modal-close" id="closeScores">&times;</button>
    <h3>📊 考试成绩记录</h3>
    <div id="scoresContent"></div>
  </div>
</div>

<script>
var QUESTIONS = ${questionsJSON};
var SECTIONS = ${sectionsJSON};
var TOTAL = ${total};
var LABELS = '${labelsStr}';

var mode = 'practice';
var currentIdx = 0;
var userAnswers = {};
var revealed = {};
var submitted = false;
var filteredQuestions = [];
var wrongBook = [];
var scoreHistory = [];

var LS_WRONG = 'cxr_wrong_book_v3';
var LS_SCORES = 'cxr_scores_v3';
var LS_ANSWERS = 'cxr_manual_answers_v3';
var LS_DARK = 'cxr_dark_v3';

function init(){
  try{
    wrongBook = JSON.parse(localStorage.getItem(LS_WRONG) || '[]');
    scoreHistory = JSON.parse(localStorage.getItem(LS_SCORES) || '[]');
    var savedAns = JSON.parse(localStorage.getItem(LS_ANSWERS) || '{}');
    QUESTIONS.forEach(function(q){
      if(!q.hasAnswer && savedAns[q.id]){ q.answer = savedAns[q.id]; q.hasAnswer = true; }
    });
  }catch(e){}
  if((localStorage.getItem(LS_DARK)||'0')==='1') document.documentElement.classList.add('dark');

  var sf = document.getElementById('sectionFilter');
  SECTIONS.forEach(function(s,i){
    var opt = document.createElement('option');
    opt.value = i;
    opt.textContent = s.title + ' (' + s.questionIds.length + '题)';
    sf.appendChild(opt);
  });
  applyFilter();
  renderAll();
}

function applyFilter(){
  var val = document.getElementById('sectionFilter').value;
  if(val === 'all') filteredQuestions = QUESTIONS.slice();
  else {
    var ids = SECTIONS[parseInt(val)].questionIds;
    filteredQuestions = QUESTIONS.filter(function(q){ return ids.indexOf(q.id) >= 0; });
  }
  currentIdx = Math.min(currentIdx, filteredQuestions.length - 1);
  if(currentIdx < 0) currentIdx = 0;
  renderAll();
}

function renderAll(){
  renderQGrid();
  renderCard();
  renderAction();
  renderNav();
  updateProgress();
  updateWrongCount();
}

function getQ(){ return filteredQuestions[currentIdx] || QUESTIONS[0]; }

function renderQGrid(){
  var grid = document.getElementById('qGrid'), html = '';
  filteredQuestions.forEach(function(q, i){
    var cls = 'qgrid-item';
    if(i === currentIdx) cls += ' current';
    var a = userAnswers[q.id];
    if(a !== undefined && a !== null && a !== '') cls += ' answered';
    if(wrongBook.indexOf(q.id) >= 0) cls += ' wrong-mark';
    html += '<div class="'+cls+'" data-idx="'+i+'">'+(i+1)+'</div>';
  });
  grid.innerHTML = html;
  grid.querySelectorAll('.qgrid-item').forEach(function(el){
    el.addEventListener('click',function(){ currentIdx = parseInt(this.dataset.idx); renderAll(); });
  });
}

function getAnswerIndex(q){
  if(!q.answer) return -1;
  if(q.options && q.options.length > 0){
    var ans = q.answer.trim();
    for(var i=0; i<q.options.length; i++){
      var opt = q.options[i];
      if(opt.label === ans || opt.label.charAt(0) === ans || opt.text === ans) return i;
    }
    var idx = LABELS.indexOf(ans.charAt(0).toUpperCase());
    if(idx >= 0 && idx < q.options.length) return idx;
  }
  return -1;
}

function formatAnswer(q){
  if(!q.answer) return '(未知)';
  if(q.options && q.options.length > 0){
    var idx = getAnswerIndex(q);
    if(idx >= 0) return (q.options[idx].label || LABELS.charAt(idx)) + '. ' + q.options[idx].text;
  }
  return q.answer;
}

function formatUserAnswer(q, sel){
  if(sel === null || sel === undefined || sel === '') return '未作答';
  if(q.options && q.options.length > 0 && typeof sel === 'number' && q.options[sel])
    return (q.options[sel].label || LABELS.charAt(sel)) + '. ' + q.options[sel].text;
  return String(sel);
}

function renderCard(){
  var q = getQ();
  if(!q){ document.getElementById('qCard').innerHTML='<p style="text-align:center;color:var(--t2);padding:40px">没有题目</p>'; return; }
  var sel = userAnswers[q.id];
  var showResult = mode === 'practice' && revealed[q.id];
  var showExamResult = mode === 'exam' && submitted;
  var html = '';
  html += '<div class="q-head"><span class="q-num">'+(currentIdx+1)+'</span><span class="q-type">'+escHtml(q.type)+'</span><span class="q-text">'+escHtml(q.text)+(q.hasAnswer?'':' <span class="no-ans-tag">答案待补充</span>')+'</span></div>';

  if(q.options && q.options.length > 0){
    html += '<div class="options">';
    q.options.forEach(function(opt, oi){
      var cls = 'opt';
      if(showResult || showExamResult){
        cls += ' done';
        var ansIdx = getAnswerIndex(q);
        if(oi === ansIdx) cls += ' correct';
        else if(sel === oi && sel !== ansIdx) cls += ' wrong';
      } else if(sel === oi) cls += ' selected';
      html += '<div class="'+cls+'" data-oi="'+oi+'"><span class="o-label">'+escHtml(opt.label || LABELS.charAt(oi))+'.</span><span>'+escHtml(opt.text)+'</span></div>';
    });
    html += '</div>';
  } else {
    html += '<input type="text" class="fill-input" id="fillAnswer" placeholder="输入你的答案" value="'+escHtml(String(sel||''))+'">';
  }

  if(showResult){
    var ansIdx = getAnswerIndex(q), correct = sel === ansIdx;
    html += '<div class="result show '+(correct?'ok':'err')+'"><strong>'+(correct?'✅ 回答正确!':'❌ 回答错误')+'</strong><div style="margin-top:4px;font-size:13px">正确答案: <b>'+escHtml(formatAnswer(q))+'</b></div>'+(q.knowledge?'<div style="font-size:12px;opacity:.8">💡 '+escHtml(q.knowledge)+'</div>':'')+'</div>';
  }
  if(showExamResult && !showResult){
    var ansIdx2 = getAnswerIndex(q), correct2 = sel === ansIdx2;
    html += '<div class="result show '+(correct2?'ok':'err')+'"><strong>'+(correct2?'✅ 正确':'❌ 错误')+'</strong><div style="margin-top:4px;font-size:13px">正确答案: <b>'+escHtml(formatAnswer(q))+'</b>'+(sel!==null&&sel!==undefined?' | 你的答案: <b>'+escHtml(formatUserAnswer(q,sel))+'</b>':'')+'</div>'+(q.knowledge?'<div style="font-size:12px;opacity:.8">💡 '+escHtml(q.knowledge)+'</div>':'')+'</div>';
  }
  if(showResult && !q.hasAnswer){
    html += '<div class="result show info"><strong>⚠️ 暂无标准答案</strong></div>';
  }

  document.getElementById('qCard').innerHTML = html;
  var done = showResult || showExamResult;
  if(!done){
    document.querySelectorAll('.opt').forEach(function(el){
      el.addEventListener('click',function(){ handleSelect(parseInt(this.dataset.oi)); });
    });
    var fillEl = document.getElementById('fillAnswer');
    if(fillEl) fillEl.addEventListener('input',function(){ userAnswers[q.id] = this.value; renderQGrid(); updateProgress(); });
  }
}

function handleSelect(oi){
  var q = getQ();
  userAnswers[q.id] = oi;
  renderQGrid();
  updateProgress();
  if(mode === 'practice'){
    revealed[q.id] = true;
    var ansIdx = getAnswerIndex(q);
    if(q.hasAnswer && oi !== ansIdx && wrongBook.indexOf(q.id) < 0){ wrongBook.push(q.id); saveWrongBook(); }
    if(q.hasAnswer && oi === ansIdx && wrongBook.indexOf(q.id) >= 0){ wrongBook = wrongBook.filter(function(x){return x!==q.id;}); saveWrongBook(); }
  }
  renderAll();
}

function renderAction(){
  var area = document.getElementById('actionArea'), q = getQ();
  if(!q){ area.innerHTML=''; return; }
  var done = revealed[q.id] || submitted, answered = userAnswers[q.id] !== undefined && userAnswers[q.id] !== null && userAnswers[q.id] !== '';
  if(mode === 'practice'){
    if(!done && answered) area.innerHTML = '<button class="big-btn btn-view" id="btnReveal">💡 查看答案</button>';
    else if(!done) area.innerHTML = '<div style="text-align:center;font-size:13px;color:var(--t2);padding:8px">点击选项查看答案</div>';
    else area.innerHTML = '';
  } else {
    if(!submitted){
      var allDone = filteredQuestions.every(function(qq){ var a=userAnswers[qq.id]; return a!==undefined&&a!==null&&a!==''; });
      area.innerHTML = '<button class="big-btn btn-submit" id="btnSubmitExam" '+(allDone?'':'disabled')+'>📋 提交试卷</button>';
      if(!allDone) area.innerHTML += '<div style="text-align:center;font-size:12px;color:var(--t2);margin-top:4px">答完所有题目后才能提交</div>';
    } else {
      area.innerHTML = '<button class="big-btn btn-retry" id="btnRetryExam">🔄 重新考试</button>';
    }
  }
  var revealBtn = document.getElementById('btnReveal');
  if(revealBtn) revealBtn.addEventListener('click',function(){
    var qq = getQ(); revealed[qq.id] = true;
    var ansIdx = getAnswerIndex(qq), sel = userAnswers[qq.id];
    if(qq.hasAnswer && sel !== ansIdx && wrongBook.indexOf(qq.id) < 0){ wrongBook.push(qq.id); saveWrongBook(); }
    renderAll();
  });
  var submitBtn = document.getElementById('btnSubmitExam');
  if(submitBtn && !submitted) submitBtn.addEventListener('click', submitExam);
  var retryBtn = document.getElementById('btnRetryExam');
  if(retryBtn) retryBtn.addEventListener('click', retryExam);
}

function renderNav(){
  document.getElementById('btnPrev').disabled = currentIdx <= 0;
  document.getElementById('btnNext').disabled = currentIdx >= filteredQuestions.length - 1;
  document.getElementById('curIndicator').textContent = (currentIdx+1) + ' / ' + filteredQuestions.length;
}

function updateProgress(){
  var answered = 0;
  filteredQuestions.forEach(function(q){ var a=userAnswers[q.id]; if(a!==undefined&&a!==null&&a!=='') answered++; });
  document.getElementById('progFill').style.width = filteredQuestions.length>0?(answered/filteredQuestions.length*100)+'%':'0%';
  document.getElementById('progLabel').textContent = '第 '+(currentIdx+1)+' / '+filteredQuestions.length+' 题';
  document.getElementById('ansCount').textContent = '已答: '+answered;
}

function updateWrongCount(){
  var el = document.getElementById('wrongCount'), btn = document.getElementById('btnClearWrong');
  if(wrongBook.length > 0){ el.textContent = '('+wrongBook.length+')'; btn.style.display = ''; }
  else { el.textContent = ''; btn.style.display = 'none'; }
}

function saveWrongBook(){
  try{ localStorage.setItem(LS_WRONG, JSON.stringify(wrongBook)); }catch(e){}
  updateWrongCount(); renderQGrid();
}

function submitExam(){
  submitted = true;
  filteredQuestions.forEach(function(q){
    var sel = userAnswers[q.id], ansIdx = getAnswerIndex(q);
    if(q.hasAnswer && sel !== ansIdx && wrongBook.indexOf(q.id) < 0) wrongBook.push(q.id);
  });
  saveWrongBook();
  var correct = 0, totalAns = 0;
  filteredQuestions.forEach(function(q){
    if(!q.hasAnswer) return;
    totalAns++;
    if(userAnswers[q.id] === getAnswerIndex(q)) correct++;
  });
  var score = totalAns > 0 ? Math.round(correct / totalAns * 100) : 0;
  scoreHistory.push({
    date: new Date().toISOString(),
    score: score, correct: correct, totalQ: totalAns, totalAll: filteredQuestions.length,
    section: document.getElementById('sectionFilter').selectedOptions[0].textContent, mode: 'exam'
  });
  try{ localStorage.setItem(LS_SCORES, JSON.stringify(scoreHistory)); }catch(e){}
  renderAll();
  showScorePopup(score, correct, totalAns);
}

function retryExam(){ submitted = false; userAnswers = {}; revealed = {}; renderAll(); }

function showScorePopup(score, correct, totalAns){
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = '<div style="background:var(--card);border-radius:16px;padding:30px;text-align:center;max-width:360px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,.3)"><div style="font-size:48px;margin-bottom:8px">'+(score>=60?'🎉':'😢')+'</div><div style="font-size:36px;font-weight:800;color:'+(score>=60?'var(--ok)':'var(--err)')+'">'+score+'分</div><div style="font-size:14px;color:var(--t2);margin:8px 0">答对 '+correct+'/'+totalAns+' 题</div><button style="margin-top:16px;padding:10px 32px;border:none;border-radius:8px;background:var(--pri);color:#fff;font-size:15px;font-weight:600;cursor:pointer">确定</button></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('button').addEventListener('click',function(){ overlay.remove(); });
  overlay.addEventListener('click',function(e){ if(e.target===overlay) overlay.remove(); });
}

function showWrongBook(){
  var modal = document.getElementById('wrongBookModal'), content = document.getElementById('wrongBookContent');
  if(wrongBook.length === 0){ content.innerHTML = '<p style="color:var(--t2);text-align:center;padding:20px">🎉 错题本为空，继续保持！</p>'; modal.classList.add('show'); return; }
  var html = '<p style="margin-bottom:12px;color:var(--t2)">共 <b>'+wrongBook.length+'</b> 道错题</p><button class="btn-sm btn-pri" id="btnPracticeWrong" style="margin-bottom:12px">📖 只练错题</button>';
  wrongBook.forEach(function(qid){
    var q = QUESTIONS.find(function(x){return x.id===qid;});
    if(!q) return;
    html += '<div style="padding:10px;margin:6px 0;background:var(--bg);border-radius:8px;font-size:13px"><b>#'+q.id+'</b> ['+escHtml(q.type)+'] '+escHtml(q.text).substring(0,60)+'...<div style="color:var(--ok);margin-top:4px">答案: '+escHtml(formatAnswer(q))+'</div><button class="btn-sm btn-err remove-wrong" data-qid="'+q.id+'" style="margin-top:4px;font-size:11px">移除</button></div>';
  });
  content.innerHTML = html;
  modal.classList.add('show');
  content.querySelectorAll('.remove-wrong').forEach(function(btn){
    btn.addEventListener('click',function(){
      var qid = parseInt(this.dataset.qid);
      wrongBook = wrongBook.filter(function(x){return x!==qid;});
      saveWrongBook(); showWrongBook();
    });
  });
  var pb = document.getElementById('btnPracticeWrong');
  if(pb) pb.addEventListener('click',function(){
    modal.classList.remove('show');
    filteredQuestions = QUESTIONS.filter(function(q){return wrongBook.indexOf(q.id)>=0;});
    currentIdx = 0; userAnswers = {}; revealed = {}; submitted = false;
    setMode('practice'); renderAll();
  });
}

function showScores(){
  var modal = document.getElementById('scoresModal'), content = document.getElementById('scoresContent');
  if(scoreHistory.length === 0){ content.innerHTML = '<p style="color:var(--t2);text-align:center;padding:20px">暂无考试成绩记录</p>'; }
  else {
    var html = '<table><thead><tr><th>时间</th><th>章节</th><th>得分</th><th>操作</th></tr></thead><tbody>';
    var rev = scoreHistory.slice().reverse();
    rev.forEach(function(r,i){
      var d = new Date(r.date), ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
      html += '<tr><td>'+ds+'</td><td>'+escHtml(r.section||'-')+'</td><td style="font-weight:700;color:'+(r.score>=60?'var(--ok)':'var(--err)')+'">'+r.score+'分 ('+r.correct+'/'+r.totalQ+')</td><td><button class="btn-sm btn-err del-score" data-idx="'+(scoreHistory.length-1-i)+'" style="font-size:11px">删除</button></td></tr>';
    });
    html += '</tbody></table><button class="btn-sm btn-err" id="btnClearScores" style="margin-top:12px">🗑 清空全部成绩</button>';
    content.innerHTML = html;
  }
  modal.classList.add('show');
  content.querySelectorAll('.del-score').forEach(function(btn){
    btn.addEventListener('click',function(){
      scoreHistory.splice(parseInt(this.dataset.idx), 1);
      try{ localStorage.setItem(LS_SCORES, JSON.stringify(scoreHistory)); }catch(e){}
      showScores();
    });
  });
  var cb = document.getElementById('btnClearScores');
  if(cb) cb.addEventListener('click',function(){ if(confirm('确定清空所有考试成绩记录？')){ scoreHistory=[]; try{localStorage.setItem(LS_SCORES,'[]');}catch(e){} showScores(); } });
}

function setMode(m){
  mode = m;
  document.querySelectorAll('.mode-tab[data-mode]').forEach(function(t){ t.classList.toggle('active', t.dataset.mode===m); });
  if(m==='practice'){ submitted = false; } else { revealed = {}; submitted = false; }
  renderAll();
}

function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

document.querySelectorAll('.mode-tab[data-mode]').forEach(function(t){ t.addEventListener('click',function(){ setMode(this.dataset.mode); }); });
document.getElementById('btnWrongBook').addEventListener('click', showWrongBook);
document.getElementById('btnScores').addEventListener('click', showScores);
document.getElementById('sectionFilter').addEventListener('change',function(){ currentIdx=0; userAnswers={}; revealed={}; submitted=false; applyFilter(); });
document.getElementById('btnPrev').addEventListener('click',function(){ if(currentIdx>0){currentIdx--;renderAll();} });
document.getElementById('btnNext').addEventListener('click',function(){ if(currentIdx<filteredQuestions.length-1){currentIdx++;renderAll();} });
document.getElementById('btnToggleDark').addEventListener('click',function(){ document.documentElement.classList.toggle('dark'); try{localStorage.setItem(LS_DARK,document.documentElement.classList.contains('dark')?'1':'0');}catch(e){} });
document.getElementById('btnReset').addEventListener('click',function(){ userAnswers={}; revealed={}; submitted=false; renderAll(); });
document.getElementById('btnClearWrong').addEventListener('click',function(){ if(confirm('确定清空错题本？')){ wrongBook=[]; saveWrongBook(); } });
document.getElementById('closeWrongBook').addEventListener('click',function(){ document.getElementById('wrongBookModal').classList.remove('show'); });
document.getElementById('closeScores').addEventListener('click',function(){ document.getElementById('scoresModal').classList.remove('show'); });
document.querySelectorAll('.modal-overlay').forEach(function(ov){ ov.addEventListener('click',function(e){ if(e.target===ov) ov.classList.remove('show'); }); });
document.addEventListener('keydown',function(e){
  if(document.querySelector('.modal-overlay.show')) return;
  if(e.key==='ArrowLeft'){ if(currentIdx>0){currentIdx--;renderAll();} }
  if(e.key==='ArrowRight'){ if(currentIdx<filteredQuestions.length-1){currentIdx++;renderAll();} }
});
init();
</script>
</body>
</html>`;
  }

  function downloadHTML() {
    if (totalQuestions === 0) {
      alert('没有题目可导出，请先抓取数据');
      return;
    }

    const html = generatePracticeHTML();
    if (!html) return;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (courseName || '练习').replace(/[\\/:*?"<>|]/g, '_').substring(0, 40);
    a.href = url;
    a.download = safeName + '_全部题目_' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('✅ HTML 文件已下载!');
  }

  // ===================== 初始化 =====================
  function init() {
    // 等待页面加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // 注入 UI
    injectUI();
    log('✅ 超星测验提取器已就绪');
    updateInfo();
  }

  init();
})();
