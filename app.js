const companies = window.COMPANIES || [];

const platforms = [
  { name: "BOSS直聘", buildUrl: query => `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(query)}` },
  { name: "智联招聘", buildUrl: query => `https://sou.zhaopin.com/?kw=${encodeURIComponent(query)}` },
  { name: "前程无忧", buildUrl: query => `https://we.51job.com/pc/search?keyword=${encodeURIComponent(query)}` },
  { name: "猎聘", buildUrl: query => `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(query)}` },
  { name: "拉勾", buildUrl: query => `https://www.lagou.com/wn/jobs?pn=1&kd=${encodeURIComponent(query)}` },
  { name: "脉脉", buildUrl: query => `https://maimai.cn/web/search_center?type=feed&query=${encodeURIComponent(query)}` }
];

const officialSearches = [
  { name: "官网招聘搜索", buildUrl: query => `https://www.baidu.com/s?wd=${encodeURIComponent(`${query} 官方招聘`)}` },
  { name: "官网校招/社招搜索", buildUrl: query => `https://www.baidu.com/s?wd=${encodeURIComponent(`${query} 校招 社招 官网`)}` }
];

const roleIndustryRules = [
  { pattern: /前端|后端|java|go|python|客户端|测试|运维|产品|运营|数据|算法|机器学习|ai|人工智能|设计/i, industries: ["互联网", "电商", "内容社区", "出行", "旅游", "网络安全", "视频娱乐", "硬件互联网", "人工智能", "云计算", "企业服务", "金融科技", "银行科技", "金融软件", "服务器与云", "房产科技"] },
  { pattern: /芯片|半导体|嵌入式|硬件|电子|fpga|驱动|通信|网络/i, industries: ["通信", "通信科技", "AI芯片", "自动驾驶芯片", "半导体", "半导体制造", "电子制造", "智能硬件", "智能安防", "硬件", "网络设备", "服务器与云"] },
  { pattern: /新能源|电池|电控|电机|汽车|自动驾驶|机械|车辆|供应链/i, industries: ["新能源车", "新能源", "汽车", "工程机械", "自动驾驶芯片", "物流", "物流科技"] },
  { pattern: /金融|银行|风控|量化|证券|基金|支付/i, industries: ["金融科技", "银行科技", "银行", "金融信息", "金融软件"] },
  { pattern: /医药|医疗|生物|临床|药物|器械/i, industries: ["医疗器械", "医药研发", "生物医药", "医药"] },
  { pattern: /物流|零售|消费|品牌|市场|供应链/i, industries: ["物流", "物流科技", "消费电子", "消费零售", "消费品", "家电"] }
];

const statusOptions = ["未看", "已打开", "已投递", "面试中", "不合适", "收藏"];
const storageKey = "job-link-finder-state-v1";

const elements = {
  queryInput: document.querySelector("#queryInput"),
  citySelect: document.querySelector("#citySelect"),
  searchBtn: document.querySelector("#searchBtn"),
  results: document.querySelector("#results"),
  resultHint: document.querySelector("#resultHint"),
  companyList: document.querySelector("#companyList"),
  companyCount: document.querySelector("#companyCount"),
  favoriteCount: document.querySelector("#favoriteCount"),
  appliedCount: document.querySelector("#appliedCount"),
  exportBtn: document.querySelector("#exportBtn")
};

elements.officialGroups = document.querySelector("#officialGroups");
elements.followResults = document.querySelector("#followResults");
elements.followHint = document.querySelector("#followHint");
elements.followTabs = document.querySelectorAll("[data-follow-filter]");

let state = loadState();
let activeFollowFilter = "all";

document.addEventListener("DOMContentLoaded", () => {
  initializeCities();
  renderOfficialGroups();
  renderCompanyList(companies);
  renderEmptyState();
  renderFollowResults();
  updateCounters();
});

elements.searchBtn.addEventListener("click", runSearch);
elements.queryInput.addEventListener("keydown", event => {
  if (event.key === "Enter") runSearch();
});
elements.citySelect.addEventListener("change", runSearch);
elements.exportBtn.addEventListener("click", exportCsv);

document.querySelectorAll("[data-query]").forEach(button => {
  button.addEventListener("click", () => {
    elements.queryInput.value = button.dataset.query;
    runSearch();
  });
});

elements.followTabs.forEach(button => {
  button.addEventListener("click", () => {
    activeFollowFilter = button.dataset.followFilter;
    elements.followTabs.forEach(tab => tab.classList.toggle("active", tab === button));
    renderFollowResults();
  });
});

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch {
    return {};
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  updateCounters();
  renderFollowResults();
}

function initializeCities() {
  const cities = [...new Set(companies.flatMap(company => company.cities))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  for (const city of cities) {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    elements.citySelect.appendChild(option);
  }
  elements.companyCount.textContent = companies.length;
}

function normalize(value) {
  return value.trim().toLowerCase();
}

function getCompanyTerms(company) {
  return [company.name, ...company.aliases].filter(Boolean);
}

function findCompany(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;

  return companies
    .map(company => {
      const matchedTerm = getCompanyTerms(company)
        .filter(term => normalizedQuery.includes(normalize(term)))
        .sort((a, b) => b.length - a.length)[0];
      return matchedTerm ? { company, matchedTerm } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.matchedTerm.length - a.matchedTerm.length)[0] || null;
}

function extractRole(query, matchedTerm) {
  if (!matchedTerm) return query.trim();
  const role = query.replace(new RegExp(escapeRegExp(matchedTerm), "i"), "").replace(/[+，,、|]/g, " ").trim();
  return role;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function companyMatchesCity(company) {
  return !elements.citySelect.value || company.cities.includes(elements.citySelect.value);
}

function renderOfficialGroups() {
  const groups = companies.reduce((result, company) => {
    const industry = company.industry || "其他";
    result[industry] = result[industry] || [];
    result[industry].push(company);
    return result;
  }, {});

  elements.officialGroups.innerHTML = Object.entries(groups)
    .sort(([, left], [, right]) => right.length - left.length)
    .map(([industry, groupCompanies]) => `
      <article class="official-group">
        <div class="official-group-head">
          <h3>${escapeHtml(industry)}</h3>
          <span>${groupCompanies.length} 家</span>
        </div>
        <div class="official-links">
          ${groupCompanies
            .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
            .map(company => `<a href="${company.careerUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(company.name)} 官网招聘">${escapeHtml(company.name)}</a>`)
            .join("")}
        </div>
      </article>
    `)
    .join("");
}

function rankCompanies(keyword, candidateCompanies) {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) return candidateCompanies.slice(0, 24);

  return candidateCompanies
    .map(company => ({ company, score: scoreCompany(company, keyword, normalizedKeyword) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.company.name.localeCompare(b.company.name, "zh-CN"))
    .slice(0, 24)
    .map(item => item.company);
}

function scoreCompany(company, keyword, normalizedKeyword) {
  const terms = [company.name, ...company.aliases, company.industry, ...company.cities].filter(Boolean);
  let score = 0;

  for (const term of terms) {
    const normalizedTerm = normalize(term);
    if (normalizedKeyword.includes(normalizedTerm)) score += 8;
    if (normalizedTerm.includes(normalizedKeyword)) score += 6;
  }

  for (const rule of roleIndustryRules) {
    if (rule.pattern.test(keyword) && rule.industries.includes(company.industry)) score += 4;
  }

  if (elements.citySelect.value && company.cities.includes(elements.citySelect.value)) score += 2;
  return score;
}

function runSearch() {
  const query = elements.queryInput.value.trim();
  const city = elements.citySelect.value;
  if (!query && !city) {
    renderEmptyState();
    renderCompanyList(companies);
    return;
  }

  const matched = findCompany(query);
  const filteredCompanies = companies.filter(company => companyMatchesCity(company));

  if (matched && companyMatchesCity(matched.company)) {
    const role = extractRole(query, matched.matchedTerm);
    renderResults([matched.company], role, "company");
    renderCompanyList(filteredCompanies, matched.company.name);
    elements.resultHint.textContent = role
      ? `已识别为“${matched.company.name} + ${role}”。`
      : `已识别为企业“${matched.company.name}”。`;
    return;
  }

  const keyword = query;
  const suggestions = rankCompanies(keyword, filteredCompanies);

  if (suggestions.length > 0) {
    renderResults(suggestions, keyword, "role-company-list");
    elements.resultHint.textContent = `找到 ${suggestions.length} 家可能相关企业。每张卡片优先给官网入口和官网岗位搜索。`;
  } else {
    renderRoleSearch(keyword || city);
    elements.resultHint.textContent = `企业库里暂时没有明显匹配项，先生成“${keyword || city}”的官网搜索和招聘平台链接。`;
  }

  renderCompanyList(suggestions.length ? suggestions : filteredCompanies);
}

function renderEmptyState() {
  elements.results.innerHTML = `
    <div class="empty-state">
      <h3>先输入一个目标</h3>
      <p>例如“腾讯 前端开发”“数据分析”“宁德时代”“上海 产品经理”。搜索结果会优先显示相关企业官网，再提供 BOSS、智联等平台链接。</p>
    </div>
  `;
}

function renderRoleSearch(keyword) {
  const query = keyword.trim();
  elements.results.innerHTML = `
    <article class="result-card">
      <div class="card-top">
        <div>
          <h3>${escapeHtml(query)}</h3>
          <p>先找企业官网入口，再看 BOSS、智联等平台。</p>
        </div>
      </div>
      <div class="link-grid">
        ${officialSearches.map(search => linkTemplate(search.name, search.buildUrl(query), "official")).join("")}
        ${platforms.map(platform => linkTemplate(platform.name, platform.buildUrl(query), "secondary")).join("")}
      </div>
    </article>
  `;
}

function renderResults(resultCompanies, role, mode) {
  elements.results.innerHTML = resultCompanies.map(company => renderCompanyCard(company, role, mode)).join("");
  bindCardActions(elements.results);
}

function renderFollowResults() {
  const followedCompanies = companies.filter(company => companyMatchesFollowFilter(company));
  const filterLabel = getFollowFilterLabel(activeFollowFilter);

  if (followedCompanies.length === 0) {
    elements.followResults.innerHTML = `
      <div class="empty-state compact-empty">
        <h3>${escapeHtml(filterLabel)}暂无记录</h3>
        <p>在搜索结果里收藏企业，或把状态改成已打开、已投递、面试中、不合适后，这里会自动出现。</p>
      </div>
    `;
    elements.followHint.textContent = `当前筛选：${filterLabel}。`;
    return;
  }

  elements.followResults.innerHTML = followedCompanies
    .map(company => renderCompanyCard(company, "", "follow"))
    .join("");
  elements.followHint.textContent = `当前筛选：${filterLabel}，共 ${followedCompanies.length} 家。`;
  bindCardActions(elements.followResults);
}

function companyMatchesFollowFilter(company) {
  const record = state[company.name];
  if (!record) return false;
  if (activeFollowFilter === "all") return Boolean(record.favorite || record.status);
  if (activeFollowFilter === "favorite") return Boolean(record.favorite);
  return record.status === activeFollowFilter;
}

function getFollowFilterLabel(filter) {
  const labels = {
    all: "全部记录",
    favorite: "已收藏"
  };
  return labels[filter] || filter;
}

function renderCompanyCard(company, role, mode) {
  const record = state[company.name] || {};
  const query = [company.name, role].filter(Boolean).join(" ");
  const isFavorite = Boolean(record.favorite);
  const status = record.status || "未看";

  return `
    <article class="result-card" data-company="${escapeHtml(company.name)}">
      <div class="card-top">
        <div>
          <h3>${escapeHtml(company.name)}</h3>
          <p>${escapeHtml(company.aliases.join(" / "))}</p>
        </div>
        <div class="card-actions">
          <button class="small-button favorite-btn" type="button">${isFavorite ? "取消收藏" : "收藏"}</button>
          <select class="status-select" aria-label="投递状态">
            ${statusOptions.map(option => `<option value="${option}" ${option === status ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="meta-row">
        <span class="badge">${escapeHtml(company.industry)}</span>
        <span>${escapeHtml(company.cities.join(" / "))}</span>
      </div>
      <div class="link-grid">
        ${linkTemplate("首选官网招聘", company.careerUrl, "official")}
        ${officialSearches.map(search => linkTemplate(`${company.name} · ${search.name}`, search.buildUrl(query || company.name), "official-search")).join("")}
        ${platforms.map(platform => linkTemplate(platform.name, platform.buildUrl(query), "secondary")).join("")}
      </div>
    </article>
  `;
}

function linkTemplate(label, url, variant) {
  const className = variant ? `button-link ${variant}` : "button-link";
  return `<a class="${className}" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function bindCardActions(root = document) {
  root.querySelectorAll(".result-card[data-company]").forEach(card => {
    const companyName = card.dataset.company;
    const favoriteButton = card.querySelector(".favorite-btn");
    const statusSelect = card.querySelector(".status-select");

    favoriteButton.addEventListener("click", () => {
      const record = state[companyName] || {};
      state[companyName] = { ...record, favorite: !record.favorite };
      favoriteButton.textContent = state[companyName].favorite ? "取消收藏" : "收藏";
      saveState();
    });

    statusSelect.addEventListener("change", () => {
      const record = state[companyName] || {};
      state[companyName] = { ...record, status: statusSelect.value };
      if (statusSelect.value === "收藏") state[companyName].favorite = true;
      saveState();
    });
  });
}

function renderCompanyList(list, activeName = "") {
  elements.companyList.innerHTML = list.map(company => `
    <button class="company-item" type="button" data-company-name="${escapeHtml(company.name)}" ${company.name === activeName ? "aria-current=\"true\"" : ""}>
      <span>
        <strong>${escapeHtml(company.name)}</strong>
        <span>${escapeHtml(company.industry)} · ${escapeHtml(company.cities.slice(0, 3).join(" / "))}</span>
      </span>
    </button>
  `).join("");

  document.querySelectorAll(".company-item").forEach(button => {
    button.addEventListener("click", () => {
      elements.queryInput.value = button.dataset.companyName;
      runSearch();
    });
  });
}

function updateCounters() {
  const records = Object.values(state);
  elements.favoriteCount.textContent = records.filter(record => record.favorite).length;
  elements.appliedCount.textContent = records.filter(record => record.status === "已投递" || record.status === "面试中").length;
}

function exportCsv() {
  const rows = [["企业", "收藏", "状态", "官网"]];
  for (const company of companies) {
    const record = state[company.name] || {};
    if (record.favorite || record.status) {
      rows.push([company.name, record.favorite ? "是" : "否", record.status || "未看", company.careerUrl]);
    }
  }

  if (rows.length === 1) {
    alert("还没有收藏或投递记录。");
    return;
  }

  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "job-application-status.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
