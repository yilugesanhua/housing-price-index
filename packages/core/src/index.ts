export const CITY_IDS = [
  "beijing", "tianjin", "shijiazhuang", "taiyuan", "huhehaote", "shenyang", "dalian", "changchun", "haerbin",
  "shanghai", "nanjing", "hangzhou", "ningbo", "hefei", "fuzhou", "xiamen", "nanchang", "jinan", "qingdao",
  "zhengzhou", "wuhan", "changsha", "guangzhou", "shenzhen", "nanning", "haikou", "chongqing", "chengdu",
  "guiyang", "kunming", "xian", "lanzhou", "xining", "yinchuan", "wulumuqi", "tangshan", "qinhuangdao",
  "baotou", "dandong", "jinzhou", "jilin", "mudanjiang", "wuxi", "xuzhou", "yangzhou", "wenzhou", "jinhua",
  "bengbu", "anqing", "quanzhou", "jiujiang", "ganzhou", "yantai", "jining", "luoyang", "pingdingshan",
  "yichang", "xiangyang", "yueyang", "changde", "shaoguan", "zhanjiang", "huizhou", "guilin", "beihai",
  "sanya", "luzhou", "nanchong", "zunyi", "dali",
] as const;

export type CityId = (typeof CITY_IDS)[number];
export const FEATURED_CITY_IDS = ["beijing", "shanghai", "guangzhou", "shenzhen", "xiamen", "fuzhou"] as const satisfies readonly CityId[];
export type PropertyType = "new" | "resale";
export type SizeBand = "all" | "le90" | "90_144" | "gt144";
export type Metric = "mom" | "yoy";
export type ViewRange = 36 | 60 | 120;
export type CityTier = "first" | "second" | "third";

export interface HousingViewState {
  metric: Metric;
  propertyType: PropertyType;
  range: ViewRange;
  cities: CityId[];
  focusCity: CityId;
  sizeBand: SizeBand;
}

export const DEFAULT_HOUSING_VIEW_STATE: HousingViewState = {
  metric: "mom",
  propertyType: "new",
  range: 120,
  cities: ["beijing", "shanghai", "guangzhou"],
  focusCity: "beijing",
  sizeBand: "all",
};

export interface CityProfile {
  province: string;
  tier: CityTier;
}

export interface RankedMarketCity {
  city_id: CityId;
  value: number;
  rank: number;
  tied: boolean;
}

export interface MarketPosition {
  stat_month: string | null;
  counts: { up: number; flat: number; down: number; missing: number };
  ranked: RankedMarketCity[];
  focus: RankedMarketCity | null;
  tier: {
    id: CityTier;
    label: string;
    average: number | null;
    ranked: RankedMarketCity[];
    focus: RankedMarketCity | null;
  };
  province: {
    name: string;
    ranked: RankedMarketCity[];
    focus: RankedMarketCity | null;
  };
}

export interface MarketBreadthPoint {
  stat_month: string;
  property_type: PropertyType;
  size_band: SizeBand;
  metric: Metric;
  up: number;
  flat: number;
  down: number;
  missing: number;
}

export interface PriceRecord {
  stat_month: string;
  release_date: string;
  city_id: CityId;
  city_name: string;
  property_type: PropertyType;
  size_band: SizeBand;
  mom_index: number | null;
  yoy_index: number | null;
  mom_change: number | null;
  yoy_change: number | null;
  mom_missing_reason: string | null;
  yoy_missing_reason: string | null;
  source_url: string;
  source_batch_id: string;
  source_record_locator: string;
  fetched_at: string;
  methodology_version: string;
  parser_version: string;
}

export interface DataManifest {
  dataset_as_of: string;
  schema_version: string;
  dataset_version: string;
  release_date: string;
  generated_at: string;
  record_count: number;
  coverage_start: string;
  coverage_end: string;
  validation_status: "passed" | "failed";
  data_status: "current" | "updating" | "stale";
  status_reason: string;
  latest_official_month: string;
  latest_official_url: string;
  last_checked_at: string;
  next_check_due_at: string;
  coverage_gaps: Array<{ stat_month: string; scope: string; reason: string; detected_at: string }>;
  data_url: string;
  overview_data_url: string;
  overview_record_count: number;
  market_data_url: string;
  market_record_count: number;
  breadth_data_url: string;
  breadth_record_count: number;
  city_data_url_template: string;
  city_record_counts: Record<CityId, number>;
}

export interface PublishedData {
  dataset_version: string;
  records: PriceRecord[];
}

export interface PublishedBreadthData {
  dataset_version: string;
  records: MarketBreadthPoint[];
}

export interface CumulativeIndexPoint {
  stat_month: string;
  value: number | null;
}

export interface PeakDrawdownPoint extends CumulativeIndexPoint {
  drawdown: number | null;
}

export const CITY_NAMES: Record<CityId, string> = {
  beijing: "北京",
  tianjin: "天津",
  shijiazhuang: "石家庄",
  taiyuan: "太原",
  huhehaote: "呼和浩特",
  shenyang: "沈阳",
  dalian: "大连",
  changchun: "长春",
  haerbin: "哈尔滨",
  shanghai: "上海",
  nanjing: "南京",
  hangzhou: "杭州",
  ningbo: "宁波",
  hefei: "合肥",
  fuzhou: "福州",
  xiamen: "厦门",
  nanchang: "南昌",
  jinan: "济南",
  qingdao: "青岛",
  zhengzhou: "郑州",
  wuhan: "武汉",
  changsha: "长沙",
  guangzhou: "广州",
  shenzhen: "深圳",
  nanning: "南宁",
  haikou: "海口",
  chongqing: "重庆",
  chengdu: "成都",
  guiyang: "贵阳",
  kunming: "昆明",
  xian: "西安",
  lanzhou: "兰州",
  xining: "西宁",
  yinchuan: "银川",
  wulumuqi: "乌鲁木齐",
  tangshan: "唐山",
  qinhuangdao: "秦皇岛",
  baotou: "包头",
  dandong: "丹东",
  jinzhou: "锦州",
  jilin: "吉林",
  mudanjiang: "牡丹江",
  wuxi: "无锡",
  xuzhou: "徐州",
  yangzhou: "扬州",
  wenzhou: "温州",
  jinhua: "金华",
  bengbu: "蚌埠",
  anqing: "安庆",
  quanzhou: "泉州",
  jiujiang: "九江",
  ganzhou: "赣州",
  yantai: "烟台",
  jining: "济宁",
  luoyang: "洛阳",
  pingdingshan: "平顶山",
  yichang: "宜昌",
  xiangyang: "襄阳",
  yueyang: "岳阳",
  changde: "常德",
  shaoguan: "韶关",
  zhanjiang: "湛江",
  huizhou: "惠州",
  guilin: "桂林",
  beihai: "北海",
  sanya: "三亚",
  luzhou: "泸州",
  nanchong: "南充",
  zunyi: "遵义",
  dali: "大理",
};

export const CITY_TIER_LABELS: Record<CityTier, string> = {
  first: "一线城市",
  second: "二线城市",
  third: "三线城市",
};

const FIRST_TIER = new Set<CityId>(["beijing", "shanghai", "guangzhou", "shenzhen"]);
const SECOND_TIER = new Set<CityId>([
  "tianjin", "shijiazhuang", "taiyuan", "huhehaote", "shenyang", "dalian", "changchun", "haerbin", "nanjing",
  "hangzhou", "ningbo", "hefei", "fuzhou", "xiamen", "nanchang", "jinan", "qingdao", "zhengzhou", "wuhan",
  "changsha", "nanning", "haikou", "chongqing", "chengdu", "guiyang", "kunming", "xian", "lanzhou", "xining",
  "yinchuan", "wulumuqi",
]);

const CITY_PROVINCES: Record<CityId, string> = {
  beijing: "北京", tianjin: "天津", shijiazhuang: "河北", taiyuan: "山西", huhehaote: "内蒙古", shenyang: "辽宁",
  dalian: "辽宁", changchun: "吉林", haerbin: "黑龙江", shanghai: "上海", nanjing: "江苏", hangzhou: "浙江",
  ningbo: "浙江", hefei: "安徽", fuzhou: "福建", xiamen: "福建", nanchang: "江西", jinan: "山东", qingdao: "山东",
  zhengzhou: "河南", wuhan: "湖北", changsha: "湖南", guangzhou: "广东", shenzhen: "广东", nanning: "广西",
  haikou: "海南", chongqing: "重庆", chengdu: "四川", guiyang: "贵州", kunming: "云南", xian: "陕西", lanzhou: "甘肃",
  xining: "青海", yinchuan: "宁夏", wulumuqi: "新疆", tangshan: "河北", qinhuangdao: "河北", baotou: "内蒙古",
  dandong: "辽宁", jinzhou: "辽宁", jilin: "吉林", mudanjiang: "黑龙江", wuxi: "江苏", xuzhou: "江苏", yangzhou: "江苏",
  wenzhou: "浙江", jinhua: "浙江", bengbu: "安徽", anqing: "安徽", quanzhou: "福建", jiujiang: "江西", ganzhou: "江西",
  yantai: "山东", jining: "山东", luoyang: "河南", pingdingshan: "河南", yichang: "湖北", xiangyang: "湖北",
  yueyang: "湖南", changde: "湖南", shaoguan: "广东", zhanjiang: "广东", huizhou: "广东", guilin: "广西",
  beihai: "广西", sanya: "海南", luzhou: "四川", nanchong: "四川", zunyi: "贵州", dali: "云南",
};

export const CITY_PROFILES: Record<CityId, CityProfile> = Object.fromEntries(CITY_IDS.map((city) => [city, {
  province: CITY_PROVINCES[city],
  tier: FIRST_TIER.has(city) ? "first" : SECOND_TIER.has(city) ? "second" : "third",
}])) as Record<CityId, CityProfile>;

export const CITY_SEARCH_ALIASES: Record<CityId, string> = {
  beijing: "bj", tianjin: "tj", shijiazhuang: "sjz", taiyuan: "ty", huhehaote: "hhht", shenyang: "sy", dalian: "dl",
  changchun: "cc", haerbin: "heb", shanghai: "sh", nanjing: "nj", hangzhou: "hz", ningbo: "nb", hefei: "hf",
  fuzhou: "fz", xiamen: "xm", nanchang: "nc", jinan: "jn", qingdao: "qd", zhengzhou: "zz", wuhan: "wh",
  changsha: "cs", guangzhou: "gz", shenzhen: "sz", nanning: "nn", haikou: "hk", chongqing: "cq", chengdu: "cd",
  guiyang: "gy", kunming: "km", xian: "xa", lanzhou: "lz", xining: "xn", yinchuan: "yc", wulumuqi: "wlmq",
  tangshan: "ts", qinhuangdao: "qhd", baotou: "bt", dandong: "dd", jinzhou: "jz", jilin: "jl", mudanjiang: "mdj",
  wuxi: "wx", xuzhou: "xz", yangzhou: "yz", wenzhou: "wz", jinhua: "jh", bengbu: "bb", anqing: "aq",
  quanzhou: "qz", jiujiang: "jj", ganzhou: "gz", yantai: "yt", jining: "jn", luoyang: "ly", pingdingshan: "pds",
  yichang: "yc", xiangyang: "xy", yueyang: "yy", changde: "cd", shaoguan: "sg", zhanjiang: "zj", huizhou: "hz",
  guilin: "gl", beihai: "bh", sanya: "sy", luzhou: "lz", nanchong: "nc", zunyi: "zy", dali: "dl",
};

const changeFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const changeMagnitudeFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const indexFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" });
const monthFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "UTC" });
const compactMonthFormatter = new Intl.DateTimeFormat("zh-CN", { year: "2-digit", month: "numeric", timeZone: "UTC" });

export function getChange(record: PriceRecord, metric: Metric): number | null {
  return metric === "mom" ? record.mom_change : record.yoy_change;
}

export function formatChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${changeFormatter.format(value)}%`;
}

export function formatChangeMagnitude(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${changeMagnitudeFormatter.format(Math.abs(value))}%`;
}

export function formatIndex(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : indexFormatter.format(value);
}

export function formatReleaseDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

export function formatStatMonth(value: string): string {
  const match = value.match(/^(20\d{2})-(\d{2})$/);
  if (!match) return value;
  return monthFormatter.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

export function formatCompactStatMonth(value: string): string {
  const match = value.match(/^(20\d{2})-(\d{2})$/);
  if (!match) return value;
  return compactMonthFormatter.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

export function getWindowRecords(records: PriceRecord[], months: number): PriceRecord[] {
  const sorted = [...records].sort((a, b) => a.stat_month.localeCompare(b.stat_month));
  const availableMonths = [...new Set(sorted.map((item) => item.stat_month))];
  const allowed = new Set(availableMonths.slice(-months));
  return sorted.filter((item) => allowed.has(item.stat_month));
}

export function getCumulativeIndexSeries(records: PriceRecord[]): CumulativeIndexPoint[] {
  const sorted = [...records].sort((a, b) => a.stat_month.localeCompare(b.stat_month));
  let value = 100;
  let broken = false;

  return sorted.map((record, index) => {
    if (index === 0) return { stat_month: record.stat_month, value };
    if (broken || record.mom_index === null) {
      broken = true;
      return { stat_month: record.stat_month, value: null };
    }
    value = value * record.mom_index / 100;
    return { stat_month: record.stat_month, value };
  });
}

export function getPeakDrawdownSeries(points: CumulativeIndexPoint[]): PeakDrawdownPoint[] {
  let peak: number | null = null;

  return points.map((point) => {
    if (point.value === null) return { ...point, drawdown: null };
    peak = peak === null ? point.value : Math.max(peak, point.value);
    return { ...point, drawdown: (point.value / peak - 1) * 100 };
  });
}

function rankMarketCities(values: Array<{ city_id: CityId; value: number }>): RankedMarketCity[] {
  const sorted = [...values].sort((a, b) => b.value - a.value || a.city_id.localeCompare(b.city_id, "en"));
  const frequency = new Map<number, number>();
  for (const item of sorted) frequency.set(item.value, (frequency.get(item.value) ?? 0) + 1);
  let previousValue: number | null = null;
  let previousRank = 0;
  return sorted.map((item, index) => {
    const rank = previousValue === item.value ? previousRank : index + 1;
    previousValue = item.value;
    previousRank = rank;
    return { ...item, rank, tied: (frequency.get(item.value) ?? 0) > 1 };
  });
}

export function getMarketPosition(records: PriceRecord[], propertyType: PropertyType, metric: Metric, focusCity: CityId, sizeBand: SizeBand = "all"): MarketPosition {
  const relevant = records.filter((record) => record.property_type === propertyType && record.size_band === sizeBand);
  const statMonth = relevant.map((record) => record.stat_month).sort().at(-1) ?? null;
  const latest = statMonth ? relevant.filter((record) => record.stat_month === statMonth) : [];
  const values = latest.map((record) => ({ city_id: record.city_id, value: getChange(record, metric) }));
  const ranked = rankMarketCities(values.filter((item): item is { city_id: CityId; value: number } => item.value !== null && Number.isFinite(item.value)));
  const counts = values.reduce((result, item) => {
    if (item.value === null || !Number.isFinite(item.value)) result.missing += 1;
    else if (item.value > 0) result.up += 1;
    else if (item.value < 0) result.down += 1;
    else result.flat += 1;
    return result;
  }, { up: 0, flat: 0, down: 0, missing: 0 });
  const profile = CITY_PROFILES[focusCity];
  const tierRanked = rankMarketCities(ranked.filter((item) => CITY_PROFILES[item.city_id].tier === profile.tier));
  const provinceRanked = rankMarketCities(ranked.filter((item) => CITY_PROFILES[item.city_id].province === profile.province));
  const tierAverage = tierRanked.length > 0 ? tierRanked.reduce((sum, item) => sum + item.value, 0) / tierRanked.length : null;

  return {
    stat_month: statMonth,
    counts,
    ranked,
    focus: ranked.find((item) => item.city_id === focusCity) ?? null,
    tier: {
      id: profile.tier,
      label: CITY_TIER_LABELS[profile.tier],
      average: tierAverage,
      ranked: tierRanked,
      focus: tierRanked.find((item) => item.city_id === focusCity) ?? null,
    },
    province: {
      name: profile.province,
      ranked: provinceRanked,
      focus: provinceRanked.find((item) => item.city_id === focusCity) ?? null,
    },
  };
}
