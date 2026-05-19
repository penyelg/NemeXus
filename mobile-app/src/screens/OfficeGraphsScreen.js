import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as XLSX from 'xlsx';
import { BarChart } from 'react-native-gifted-charts';
import Card from '../components/Card';
import ScreenShell from '../components/ScreenShell';
import { EmptyState, SplitExportButton, YearStepper } from '../components/UiControls';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getDailyProductionForMonth, getMonthlyAnalyticsForYear, getOfficeDashboardSnapshot } from '../services/office';
import { getResponsiveMetrics, scaleStyleDefinitions } from '../theme';
import { saveNativeExportFile, buildNativeExportSuccessMessage } from '../utils/exportFiles';

const GRAPH_EXPORT_OPTIONS = [
  { key: 'pdf', label: 'PDF', iconName: 'document-attach-outline' },
  { key: 'xlsx', label: 'Excel', iconName: 'grid-outline' },
];

function formatNumber(value, decimals = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return '-';
  }

  return parsed.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatHeaderUpdatedTime(value) {
  if (!(value instanceof Date)) {
    return '--:--';
  }

  return value.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function roundExportNumber(value, decimals = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(parsed.toFixed(decimals));
}

function displayExportValue(value) {
  if (typeof value === 'number') {
    return formatNumber(value, 2);
  }

  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildExportFileName(extension) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `monthly-analytics-${stamp}.${extension}`;
}

function sortExportRows(rows = []) {
  return [...rows].sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')));
}

function buildSheetRows(columns, rows) {
  return [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => column.render(row))),
  ];
}

function buildAnalyticsExportSections({ monthlyProduction, monthlyPowerConsumption, monthlyChemicalUsage }) {
  const productionRows = sortExportRows(monthlyProduction?.rows);
  const powerRows = sortExportRows(monthlyPowerConsumption?.rows);
  const chemicalRows = sortExportRows(monthlyChemicalUsage?.rows);

  return [
    {
      title: 'Summary',
      sheetName: 'Summary',
      columns: [
        { label: 'Metric', render: (row) => row.metric },
        { label: 'Value', render: (row) => roundExportNumber(row.value) },
      ],
      rows: [
        { metric: 'Total Production', value: monthlyProduction?.totalProduction ?? 0 },
        { metric: 'Total Power', value: monthlyPowerConsumption?.totalPower ?? 0 },
        { metric: 'Total Chlorine', value: monthlyChemicalUsage?.totalChlorine ?? 0 },
        { metric: 'Total Peroxide', value: monthlyChemicalUsage?.totalPeroxide ?? 0 },
      ],
    },
    {
      title: 'Monthly Production',
      sheetName: 'Production',
      columns: [
        { label: 'Month', render: (row) => row.label },
        { label: 'Production', render: (row) => roundExportNumber(row.production) },
      ],
      rows: productionRows,
    },
    {
      title: 'Monthly Power Usage',
      sheetName: 'Power Usage',
      columns: [
        { label: 'Month', render: (row) => row.label },
        { label: 'Chlorination Power', render: (row) => roundExportNumber(row.chlorinationPower) },
        { label: 'Deepwell Power', render: (row) => roundExportNumber(row.deepwellPower) },
        { label: 'Total Power', render: (row) => roundExportNumber(row.totalPower) },
      ],
      rows: powerRows,
    },
    {
      title: 'Monthly Chemical Usage',
      sheetName: 'Chemical Usage',
      columns: [
        { label: 'Month', render: (row) => row.label },
        { label: 'Chlorine', render: (row) => roundExportNumber(row.chlorineUsage) },
        { label: 'Peroxide', render: (row) => roundExportNumber(row.peroxideUsage) },
        { label: 'Total Chemical', render: (row) => roundExportNumber(row.totalUsage) },
      ],
      rows: chemicalRows,
    },
  ];
}

function buildPdfSection(section) {
  const head = section.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  const body = section.rows
    .map((row) => {
      const cells = section.columns
        .map((column) => `<td>${escapeHtml(displayExportValue(column.render(row)))}</td>`)
        .join('');

      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `
    <section>
      <h2>${escapeHtml(section.title)}</h2>
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

function buildAnalyticsPdfDocument(sections) {
  const generatedAt = new Date().toLocaleString('en-US');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Helvetica, Arial, sans-serif; color: #0f172a; padding: 24px; }
          h1 { margin: 0 0 6px; font-size: 24px; }
          .meta { margin: 0 0 18px; color: #475569; font-size: 12px; }
          section { margin-top: 20px; page-break-inside: avoid; }
          h2 { margin: 0 0 10px; font-size: 16px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
          th, td { border: 1px solid #cbd5e1; padding: 7px; vertical-align: top; word-wrap: break-word; }
          th { background: #0f766e; color: #ffffff; font-weight: 700; }
          tr:nth-child(even) td { background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>Monthly Analytics Export</h1>
        <p class="meta">Generated: ${escapeHtml(generatedAt)}</p>
        ${sections.map(buildPdfSection).join('')}
      </body>
    </html>
  `;
}

function SectionHeader({ title, body, iconName = 'bar-chart-outline', iconColor, styles }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionIconWrap}>
          <Ionicons name={iconName} size={14} color={iconColor} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {body ? <Text style={styles.sectionBody}>{body}</Text> : null}
    </View>
  );
}

function GraphSkeletonCard({ styles, cardStyle, isDaily = false, isSplit = false }) {
  const pulseOpacity = useRef(new Animated.Value(0.55)).current;
  const barHeights = isDaily
    ? [88, 132, 104, 156, 118, 178, 142, 96, 164, 124, 148, 108]
    : [96, 140, 118, 168, 132, 188, 150, 112, 176, 136];

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.55,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [pulseOpacity]);

  const skeletonStyle = (style) => [
    styles.skeletonBlock,
    ...(Array.isArray(style) ? style : [style]),
    { opacity: pulseOpacity },
  ];

  return (
    <Card style={[styles.panelCard, cardStyle]}>
      <View style={styles.skeletonHeaderRow}>
        <Animated.View style={skeletonStyle(styles.skeletonIcon)} />
        <Animated.View style={skeletonStyle(styles.skeletonTitleLine)} />
      </View>

      <View style={styles.skeletonMetaRow}>
        <Animated.View style={skeletonStyle(styles.skeletonSummaryPill)} />
        <Animated.View style={skeletonStyle(styles.skeletonToolbarPill)} />
      </View>

      <View style={[styles.skeletonChartArea, isDaily && styles.skeletonChartAreaTall]}>
        <View style={styles.skeletonAxisColumn}>
          {[0, 1, 2, 3].map((item) => (
            <Animated.View key={item} style={skeletonStyle(styles.skeletonAxisTick)} />
          ))}
        </View>
        <View style={styles.skeletonBarsRow}>
          {barHeights.map((height, index) => (
            <View key={`${height}-${index}`} style={styles.skeletonBarSlot}>
              {isSplit ? (
                <>
                  <Animated.View style={skeletonStyle([styles.skeletonBarSegmentTop, { height: Math.round(height * 0.42) }])} />
                  <Animated.View style={skeletonStyle([styles.skeletonBarSegmentBottom, { height: Math.round(height * 0.58) }])} />
                </>
              ) : (
                <Animated.View style={skeletonStyle([styles.skeletonBar, { height }])} />
              )}
              <Animated.View style={skeletonStyle(styles.skeletonBarLabel)} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.skeletonLegendRow}>
        <Animated.View style={skeletonStyle(styles.skeletonLegendItem)} />
        {isSplit ? <Animated.View style={skeletonStyle(styles.skeletonLegendItem)} /> : null}
      </View>
    </Card>
  );
}

function GraphSkeletonGrid({ styles, useTwoColumnCharts }) {
  const cardStyle = useTwoColumnCharts ? styles.chartGridCard : null;

  return (
    <View style={styles.chartGrid}>
      <GraphSkeletonCard styles={styles} cardStyle={cardStyle} />
      <GraphSkeletonCard styles={styles} cardStyle={cardStyle} isDaily />
      <GraphSkeletonCard styles={styles} cardStyle={cardStyle} isSplit />
      <GraphSkeletonCard styles={styles} cardStyle={cardStyle} isSplit />
    </View>
  );
}

function ChartValueDetails({ selected, styles }) {
  if (!selected) {
    return null;
  }

  const isCompact = selected.items.length === 1 && !selected.totalLabel;
  const isSplitCompact = selected.items.length > 1;

  return (
    <View
      style={[
        styles.chartValueDetails,
        isCompact && styles.chartValueDetailsCompact,
        isSplitCompact && styles.chartValueDetailsSplitCompact,
      ]}
    >
      <View
        style={[
          styles.chartValueDetailsHeader,
          isCompact && styles.chartValueDetailsHeaderCompact,
          isSplitCompact && styles.chartValueDetailsHeaderSplitCompact,
        ]}
      >
        <Text style={styles.chartValueDetailsTitle}>{selected.title}</Text>
      </View>

      <View
        style={[
          styles.chartValueDetailsRow,
          isCompact && styles.chartValueDetailsRowCompact,
          isSplitCompact && styles.chartValueDetailsRowSplitCompact,
        ]}
      >
        {selected.items.map((item) => (
          <View
            key={item.label}
            style={[
              styles.chartValueDetailsItem,
              isCompact && styles.chartValueDetailsItemCompact,
              isSplitCompact && styles.chartValueDetailsItemSplitCompact,
            ]}
          >
            <View style={[styles.chartValueDetailsDot, { backgroundColor: item.color }]} />
            {item.iconName ? <Ionicons name={item.iconName} size={12} color={item.color} /> : null}
            {!isCompact ? <Text style={styles.chartValueDetailsLabel}>{item.label}</Text> : null}
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
              style={styles.chartValueDetailsValue}
            >
              {formatNumber(item.value, 2)}
            </Text>
          </View>
        ))}
      </View>

      {selected.totalLabel ? (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.55}
          style={styles.chartValueDetailsTotal}
        >
          {selected.totalLabel}: {formatNumber(selected.totalValue, 2)}
        </Text>
      ) : null}
    </View>
  );
}

const TABLET_DEFAULT_CHART_ZOOM = 1.25;
const CHART_HEIGHT_COMPACT = 230;
const CHART_HEIGHT_WIDE = 270;
const CHART_CONTAINER_MIN_HEIGHT = 292;
const MONTHLY_BASE_BAR_WIDTH_COMPACT = 30;
const MONTHLY_BASE_BAR_WIDTH_WIDE = 34;
const MONTHLY_BASE_SPACING_COMPACT = 32;
const MONTHLY_BASE_SPACING_WIDE = 42;
const MONTHLY_CONTENT_WIDTH_COMPACT = 560;
const MONTHLY_CONTENT_WIDTH_WIDE = 820;
const MONTH_PICKER_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTH_PICKER_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function createMonthYearLabel(date) {
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function createDailyProductionPlaceholder(monthDate) {
  const today = new Date();
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const chartEnd = monthStart > today ? monthEnd : monthEnd > today ? today : monthEnd;
  const rows = [];

  for (let date = new Date(monthStart); date <= chartEnd; date.setDate(date.getDate() + 1)) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    rows.push({
      key,
      date: key,
      label: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
      production: 0,
    });
  }

  rows.sort((a, b) => b.key.localeCompare(a.key));

  return {
    monthLabel: createMonthYearLabel(monthDate),
    totalProduction: 0,
    rows,
  };
}

function visibleMonthlyIndexesForYear(year) {
  const today = new Date();
  const lastMonthIndex = year === today.getFullYear() ? today.getMonth() : 11;

  return MONTH_PICKER_LABELS
    .map((label, monthIndex) => ({ label, monthIndex }))
    .filter((row) => row.monthIndex <= lastMonthIndex);
}

function createMonthlyRowsForYear(year) {
  return visibleMonthlyIndexesForYear(year).map(({ label, monthIndex }) => ({
    key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    label: `${label}-${String(year).slice(-2)}`,
  })).reverse();
}

function createMonthlyAnalyticsPlaceholder(year) {
  const rows = createMonthlyRowsForYear(year);

  return {
    monthlyProduction: {
      totalProduction: 0,
      averageProduction: 0,
      rows: rows.map((row) => ({ ...row, production: 0, total: 0, readingCount: 0 })),
    },
    monthlyPowerConsumption: {
      totalPower: 0,
      rows: rows.map((row) => ({ ...row, chlorinationPower: 0, deepwellPower: 0, totalPower: 0 })),
    },
    monthlyChemicalUsage: {
      totalChlorine: 0,
      totalPeroxide: 0,
      rows: rows.map((row) => ({ ...row, chlorineUsage: 0, peroxideUsage: 0, totalUsage: 0 })),
    },
  };
}

function YearPickerPanel({ year, onChangeYear, isLoading, palette, styles, compact, label = 'Year' }) {
  return (
    <View style={[styles.yearPickerPanel, compact && styles.yearPickerPanelCompact]}>
      <View style={styles.monthPickerHeader}>
        <Text style={styles.chartToolbarLabel}>{label}</Text>
        {isLoading ? <ActivityIndicator size="small" color={palette.teal600} /> : null}
      </View>
      <View style={styles.yearPickerRow}>
        <Pressable
          onPress={() => onChangeYear(year - 1)}
          disabled={isLoading}
          accessibilityLabel={`Show ${year - 1} monthly charts`}
          style={({ pressed }) => [
            styles.zoomButton,
            pressed && !isLoading ? styles.pressed : null,
            isLoading ? styles.zoomButtonDisabled : null,
          ]}
        >
          <Ionicons name="chevron-back" size={15} color={palette.ink900} />
        </Pressable>
        <Text style={styles.yearPickerValue}>{year}</Text>
        <Pressable
          onPress={() => onChangeYear(year + 1)}
          disabled={isLoading}
          accessibilityLabel={`Show ${year + 1} monthly charts`}
          style={({ pressed }) => [
            styles.zoomButton,
            pressed && !isLoading ? styles.pressed : null,
            isLoading ? styles.zoomButtonDisabled : null,
          ]}
        >
          <Ionicons name="chevron-forward" size={15} color={palette.ink900} />
        </Pressable>
      </View>
    </View>
  );
}

function YearDropdownFilter({ year, onChangeYear, isLoading, palette, styles, accessibilityPrefix, centered = false, header = false, style }) {
  return (
    <YearStepper
      year={year}
      onChangeYear={onChangeYear}
      loading={isLoading}
      accessibilityPrefix={accessibilityPrefix}
      centered={centered}
      header={header}
      style={style}
    />
  );
}

function ChartTitleFilterGroup({ title, iconName, palette, styles }) {
  return (
    <View style={[styles.sectionTitleRow, styles.chartTitleWrap]}>
      <View style={styles.sectionIconWrap}>
        <Ionicons name={iconName} size={14} color={palette.teal600} />
      </View>
      <Text numberOfLines={2} style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function MonthlyChartYearRow({ selectedYear, onChangeYear, isLoadingYear, accessibilityPrefix, palette, styles, header = false, compact = false }) {
  return (
    <View style={header ? styles.chartYearHeaderRow : compact ? styles.chartYearCompactItem : styles.chartYearStandaloneRow}>
      <YearDropdownFilter
        year={selectedYear}
        onChangeYear={onChangeYear}
        isLoading={isLoadingYear}
        palette={palette}
        styles={styles}
        accessibilityPrefix={accessibilityPrefix}
        centered
        header={header}
      />
    </View>
  );
}

function MonthlyProductionCard({
  monthlyProduction,
  palette,
  isDark,
  isWide,
  screenWidth,
  styles,
  cardStyle,
  selectedYear = new Date().getFullYear(),
  onChangeYear = () => {},
  isLoadingYear = false,
}) {
  const rows = monthlyProduction?.rows ?? [];
  const zoomLevel = TABLET_DEFAULT_CHART_ZOOM;
  const [selectedBar, setSelectedBar] = useState(null);
  const stackProductionKpi = screenWidth < 430;
  const totalProduction =
    monthlyProduction?.totalProduction ??
    rows.reduce((sum, row) => sum + (Number(row.production) || 0), 0);
  const maxVolume = Math.max(
    ...rows.map((row) => row.production || 0),
    1
  );
  const chartHeight = isWide ? CHART_HEIGHT_WIDE : CHART_HEIGHT_COMPACT;
  const baseBarWidth = isWide ? MONTHLY_BASE_BAR_WIDTH_WIDE : MONTHLY_BASE_BAR_WIDTH_COMPACT;
  const baseSpacing = isWide ? MONTHLY_BASE_SPACING_WIDE : MONTHLY_BASE_SPACING_COMPACT;
  const barWidth = Math.round(baseBarWidth * zoomLevel);
  const spacing = Math.round(baseSpacing * zoomLevel);
  const rawViewportWidth = Math.max(280, screenWidth - (isWide ? 120 : 72));
  const baseContentWidth = Math.max(rows.length * (baseBarWidth + baseSpacing) + 90, isWide ? MONTHLY_CONTENT_WIDTH_WIDE : MONTHLY_CONTENT_WIDTH_COMPACT);
  const chartViewportWidth = Math.min(rawViewportWidth, Math.max(280, baseContentWidth - 120));
  const chartMaxValue = maxVolume <= 0 ? 1 : Math.ceil(maxVolume * 1.18);
  const hasData = rows.some((row) => row.production > 0);
  const valueLabelWidth = Math.round(Math.max(52, Math.min(74, barWidth + 28)));
  const valueLabelFontSize = zoomLevel >= 1.35 ? 10 : 9;
  const topLabelContainerStyle = {
    width: valueLabelWidth,
    height: 18,
    left: (barWidth - valueLabelWidth) / 2,
    justifyContent: 'center',
    alignItems: 'center',
  };
  useEffect(() => {
    setSelectedBar(null);
  }, [selectedYear]);
  const chartData = rows.map((row) => {
    const production = Math.max(0, row.production || 0);

    return {
      value: production,
      label: row.label,
      frontColor: palette.teal600,
      gradientColor: palette.cyan300,
      onPress: () =>
        setSelectedBar({
          title: row.label,
          items: [{ label: 'Production', value: production, color: palette.teal600 }],
        }),
      topLabelContainerStyle,
      topLabelComponent: () =>
        row.production > 0 ? (
          <View style={styles.chartPlainValueWrap}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.chartPlainValueText, { fontSize: valueLabelFontSize }]}>
              {formatNumber(row.production, 2)}
            </Text>
          </View>
        ) : null,
    };
  });
  const chartKey = `monthly-production:${selectedYear}:${rows.map((row) => `${row.key}:${row.production || 0}`).join('|')}`;

  return (
    <Card style={[styles.panelCard, cardStyle]}>
      <View style={[styles.chartAppHeader, styles.monthlyProductionHeader]}>
        <ChartTitleFilterGroup
          title="Monthly Production"
          iconName="bar-chart-outline"
          palette={palette}
          styles={styles}
        />
      </View>

      <View style={[styles.productionKpiStrip, styles.monthlyProductionKpiStrip, stackProductionKpi && styles.monthlyProductionKpiStripPhone]}>
        <View style={[styles.productionKpiIcon, stackProductionKpi && styles.productionKpiIconCompact]}>
          <Ionicons name="trending-up-outline" size={16} color={palette.teal600} />
        </View>
        <View style={styles.productionKpiCopy}>
          <Text style={styles.productionKpiLabel}>Total Production</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.productionKpiValue}>
            {formatNumber(totalProduction)}
          </Text>
        </View>
        <YearDropdownFilter
          year={selectedYear}
          onChangeYear={onChangeYear}
          isLoading={isLoadingYear}
          accessibilityPrefix="monthly production"
          header
          style={[styles.monthlyProductionKpiYearPicker, stackProductionKpi && styles.monthlyProductionKpiYearPickerPhone]}
        />
      </View>

      <View style={styles.productionChart}>
        <BarChart
          key={chartKey}
          data={chartData}
          width={chartViewportWidth}
          height={chartHeight}
          barWidth={barWidth}
          spacing={spacing}
          initialSpacing={18}
          endSpacing={18}
          maxValue={chartMaxValue}
          noOfSections={4}
          showGradient
          roundedBottom={false}
          barBorderTopLeftRadius={5}
          barBorderTopRightRadius={5}
          barBorderBottomLeftRadius={0}
          barBorderBottomRightRadius={0}
          isAnimated
          animationDuration={800}
          showValuesAsTopLabel={false}
          xAxisColor={palette.lineStrong}
          yAxisColor={palette.lineStrong}
          rulesColor={palette.line}
          rulesThickness={1}
          yAxisTextStyle={styles.chartAxisLabel}
          xAxisLabelTextStyle={styles.chartMonthLabel}
          yAxisLabelWidth={56}
          xAxisTextNumberOfLines={1}
          labelsExtraHeight={28}
          formatYLabel={(value) => formatNumber(value, 0)}
          disableScroll={false}
          nestedScrollEnabled
          showScrollIndicator
          indicatorColor={isDark ? 'white' : 'black'}
        />
        {isLoadingYear ? (
          <View style={styles.chartLoadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={palette.teal600} />
            <Text style={styles.chartLoadingText}>Loading {selectedYear}</Text>
          </View>
        ) : null}
      </View>

      <ChartValueDetails selected={selectedBar} styles={styles} />

      <View style={styles.productionLegendRow}>
        <View style={styles.productionLegendItem}>
          <View style={[styles.productionLegendSwatch, styles.productionLegendProduction]} />
          <Text style={styles.productionLegendText}>Production</Text>
        </View>
      </View>

      {!hasData ? (
        <EmptyState
          title="No monthly production yet"
          body="Monthly production will appear here after readings with totalizer values are saved."
          iconName="bar-chart-outline"
        />
      ) : null}
    </Card>
  );
}

function MonthlyPowerConsumptionCard({
  monthlyPowerConsumption,
  palette,
  isDark,
  isWide,
  screenWidth,
  styles,
  cardStyle,
  selectedYear = new Date().getFullYear(),
  onChangeYear = () => {},
  isLoadingYear = false,
}) {
  const rows = monthlyPowerConsumption?.rows ?? [];
  const zoomLevel = TABLET_DEFAULT_CHART_ZOOM;
  const [selectedBar, setSelectedBar] = useState(null);
  const stackPowerKpi = screenWidth < 430;
  const chlorinationPowerColor = isDark ? palette.teal500 : palette.teal600;
  const deepwellPowerColor = palette.amber500;
  const totalPower =
    monthlyPowerConsumption?.totalPower ??
    rows.reduce((sum, row) => sum + (Number(row.totalPower) || 0), 0);
  const maxPower = Math.max(
    ...rows.map((row) => row.totalPower || (row.chlorinationPower || 0) + (row.deepwellPower || 0)),
    1
  );
  const chartHeight = isWide ? CHART_HEIGHT_WIDE : CHART_HEIGHT_COMPACT;
  const baseBarWidth = isWide ? MONTHLY_BASE_BAR_WIDTH_WIDE : MONTHLY_BASE_BAR_WIDTH_COMPACT;
  const baseSpacing = isWide ? MONTHLY_BASE_SPACING_WIDE : MONTHLY_BASE_SPACING_COMPACT;
  const barWidth = Math.round(baseBarWidth * zoomLevel);
  const spacing = Math.round(baseSpacing * zoomLevel);
  const rawViewportWidth = Math.max(280, screenWidth - (isWide ? 120 : 72));
  const baseContentWidth = Math.max(rows.length * (baseBarWidth + baseSpacing) + 90, isWide ? MONTHLY_CONTENT_WIDTH_WIDE : MONTHLY_CONTENT_WIDTH_COMPACT);
  const chartViewportWidth = Math.min(rawViewportWidth, Math.max(280, baseContentWidth - 120));
  const chartMaxValue = maxPower <= 0 ? 1 : Math.ceil(maxPower * 1.22);
  const hasData = rows.some((row) => row.totalPower > 0);
  const segmentValueFontSize = zoomLevel >= 1.35 ? 8 : 7;
  const totalLabelWidth = Math.round(Math.max(56, Math.min(82, barWidth + 34)));
  const totalValueFontSize = zoomLevel >= 1.35 ? 9 : 8;
  const totalLabelContainerStyle = {
    width: totalLabelWidth,
    height: 18,
    left: (barWidth - totalLabelWidth) / 2,
    justifyContent: 'center',
    alignItems: 'center',
  };
  const renderPowerTotalLabel = (value) =>
    value > 0 ? (
      <View style={styles.chartPlainValueWrap}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.chartPlainValueText, { fontSize: totalValueFontSize }]}>
          {formatNumber(value, 2)}
        </Text>
      </View>
    ) : null;
  const renderStackValue = (value, textColor) =>
    value > 0 ? (
      <View style={styles.stackValueWrap}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            styles.stackValueText,
            {
              color: textColor,
              fontSize: segmentValueFontSize,
              textShadowColor: textColor === '#FFFFFF' ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.42)',
            },
          ]}
        >
          {formatNumber(value, 2)}
        </Text>
      </View>
    ) : null;
  const createPowerStack = ({ value, color, textColor, isBottom, isTop }) => ({
    value,
    color,
    borderBottomLeftRadius: isBottom ? 5 : 0,
    borderBottomRightRadius: isBottom ? 5 : 0,
    borderTopLeftRadius: isTop ? 5 : 0,
    borderTopRightRadius: isTop ? 5 : 0,
  });
  useEffect(() => {
    setSelectedBar(null);
  }, [selectedYear]);
  const chartData = rows.map((row) => {
    const chlorinationPower = Math.max(0, row.chlorinationPower || 0);
    const deepwellPower = Math.max(0, row.deepwellPower || 0);
    const totalMonthPower = Math.max(0, row.totalPower || chlorinationPower + deepwellPower);
    const powerStacks = [
      { key: 'deepwell', value: deepwellPower, color: deepwellPowerColor, textColor: '#11233B' },
      { key: 'chlorination', value: chlorinationPower, color: chlorinationPowerColor, textColor: '#FFFFFF' },
    ];

    return {
      label: row.label,
      onPress: () =>
        setSelectedBar({
          title: row.label,
          totalLabel: 'Total',
          totalValue: totalMonthPower,
          items: [
            { label: 'Chlorination', value: chlorinationPower, color: chlorinationPowerColor },
            { label: 'Deepwell', value: deepwellPower, color: deepwellPowerColor },
          ],
        }),
      topLabelContainerStyle: totalLabelContainerStyle,
      topLabelComponent: () => renderPowerTotalLabel(totalMonthPower),
      stacks: powerStacks.map((stack, index) =>
        createPowerStack({
          ...stack,
          isBottom: index === 0,
          isTop: index === powerStacks.length - 1,
        })
      ),
    };
  });
  const chartKey = `monthly-power:${selectedYear}:${rows.map((row) => `${row.key}:${row.chlorinationPower || 0}:${row.deepwellPower || 0}`).join('|')}`;

  return (
    <Card style={[styles.panelCard, cardStyle]}>
      <View style={[styles.chartAppHeader, styles.monthlyProductionHeader]}>
        <ChartTitleFilterGroup
          title="Monthly Power Consumption"
          iconName="flash-outline"
          palette={palette}
          styles={styles}
        />
      </View>

      <View style={[styles.productionKpiStrip, styles.monthlyProductionKpiStrip, stackPowerKpi && styles.monthlyProductionKpiStripPhone]}>
        <View style={[styles.productionKpiIcon, stackPowerKpi && styles.productionKpiIconCompact]}>
          <Ionicons name="flash-outline" size={16} color={palette.teal600} />
        </View>
        <View style={styles.productionKpiCopy}>
          <Text style={styles.productionKpiLabel}>Total Power</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.productionKpiValue}>
            {formatNumber(totalPower)}
          </Text>
        </View>
        <YearDropdownFilter
          year={selectedYear}
          onChangeYear={onChangeYear}
          isLoading={isLoadingYear}
          accessibilityPrefix="monthly power"
          header
          style={[styles.monthlyProductionKpiYearPicker, stackPowerKpi && styles.monthlyProductionKpiYearPickerPhone]}
        />
      </View>

      <View style={styles.productionChart}>
        <BarChart
          key={chartKey}
          stackData={chartData}
          width={chartViewportWidth}
          height={chartHeight}
          barWidth={barWidth}
          spacing={spacing}
          initialSpacing={18}
          endSpacing={18}
          maxValue={chartMaxValue}
          noOfSections={5}
          roundedTop
          roundedBottom={false}
          isAnimated
          animationDuration={800}
          xAxisColor={palette.lineStrong}
          yAxisColor={palette.lineStrong}
          rulesColor={palette.line}
          rulesThickness={1}
          yAxisTextStyle={styles.chartAxisLabel}
          xAxisLabelTextStyle={styles.chartMonthLabel}
          yAxisLabelWidth={58}
          xAxisTextNumberOfLines={1}
          labelsExtraHeight={28}
          formatYLabel={(value) => formatNumber(value, 0)}
          disableScroll={false}
          nestedScrollEnabled
          showScrollIndicator
          indicatorColor={isDark ? 'white' : 'black'}
        />
        {isLoadingYear ? (
          <View style={styles.chartLoadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={palette.teal600} />
            <Text style={styles.chartLoadingText}>Loading {selectedYear}</Text>
          </View>
        ) : null}
      </View>

      <ChartValueDetails selected={selectedBar} styles={styles} />

      <View style={styles.productionLegendRow}>
        <View style={styles.productionLegendItem}>
          <View style={[styles.productionLegendSwatch, styles.powerLegendChlorination]} />
          <Text style={styles.productionLegendText}>Chlorination</Text>
        </View>
        <View style={styles.productionLegendItem}>
          <View style={[styles.productionLegendSwatch, styles.powerLegendDeepwell]} />
          <Text style={styles.productionLegendText}>Deepwell</Text>
        </View>
      </View>

      {!hasData ? (
        <EmptyState
          title="No power consumption yet"
          body="Monthly power consumption will appear here after chlorination and deepwell power values are saved."
          iconName="flash-outline"
        />
      ) : null}
    </Card>
  );
}

function MonthlyChemicalUsageCard({
  monthlyChemicalUsage,
  palette,
  isDark,
  isWide,
  screenWidth,
  styles,
  cardStyle,
  selectedYear = new Date().getFullYear(),
  onChangeYear = () => {},
  isLoadingYear = false,
}) {
  const rows = monthlyChemicalUsage?.rows ?? [];
  const zoomLevel = TABLET_DEFAULT_CHART_ZOOM;
  const [selectedBar, setSelectedBar] = useState(null);
  const stackChemicalKpi = screenWidth < 430;
  const chlorineColor = isDark ? '#34BFA3' : '#0F8F7C';
  const peroxideColor = isDark ? '#F6C85F' : '#E7A321';
  const totalChlorine =
    monthlyChemicalUsage?.totalChlorine ??
    rows.reduce((sum, row) => sum + (Number(row.chlorineUsage) || 0), 0);
  const totalPeroxide =
    monthlyChemicalUsage?.totalPeroxide ??
    rows.reduce((sum, row) => sum + (Number(row.peroxideUsage) || 0), 0);
  const maxUsage = Math.max(
    ...rows.map((row) => row.totalUsage || (row.chlorineUsage || 0) + (row.peroxideUsage || 0)),
    1
  );
  const chartHeight = isWide ? CHART_HEIGHT_WIDE : CHART_HEIGHT_COMPACT;
  const baseBarWidth = isWide ? MONTHLY_BASE_BAR_WIDTH_WIDE : MONTHLY_BASE_BAR_WIDTH_COMPACT;
  const baseSpacing = isWide ? MONTHLY_BASE_SPACING_WIDE : MONTHLY_BASE_SPACING_COMPACT;
  const barWidth = Math.round(baseBarWidth * zoomLevel);
  const spacing = Math.round(baseSpacing * zoomLevel);
  const rawViewportWidth = Math.max(280, screenWidth - (isWide ? 120 : 72));
  const baseContentWidth = Math.max(rows.length * (baseBarWidth + baseSpacing) + 90, isWide ? MONTHLY_CONTENT_WIDTH_WIDE : MONTHLY_CONTENT_WIDTH_COMPACT);
  const chartViewportWidth = Math.min(rawViewportWidth, Math.max(280, baseContentWidth - 120));
  const chartMaxValue = maxUsage <= 0 ? 1 : Math.ceil(maxUsage * 1.22);
  const hasData = rows.some((row) => row.totalUsage > 0 || row.chlorineUsage > 0 || row.peroxideUsage > 0);
  const segmentValueFontSize = zoomLevel >= 1.35 ? 8 : 7;
  const totalLabelWidth = Math.round(Math.max(56, Math.min(82, barWidth + 34)));
  const totalValueFontSize = zoomLevel >= 1.35 ? 9 : 8;
  const totalLabelContainerStyle = {
    width: totalLabelWidth,
    height: 18,
    left: (barWidth - totalLabelWidth) / 2,
    justifyContent: 'center',
    alignItems: 'center',
  };
  const renderChemicalTotalLabel = (value) =>
    value > 0 ? (
      <View style={styles.chartPlainValueWrap}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.chartPlainValueText, { fontSize: totalValueFontSize }]}>
          {formatNumber(value, 2)}
        </Text>
      </View>
    ) : null;
  const renderChemicalStackValue = (value, textColor) =>
    value > 0 ? (
      <View style={styles.stackValueWrap}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            styles.stackValueText,
            {
              color: textColor,
              fontSize: segmentValueFontSize,
              textShadowColor: textColor === '#FFFFFF' ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.42)',
            },
          ]}
        >
          {formatNumber(value, 2)}
        </Text>
      </View>
    ) : null;
  const createChemicalStack = ({ value, color, textColor, isBottom, isTop }) => ({
    value,
    color,
    borderBottomLeftRadius: isBottom ? 5 : 0,
    borderBottomRightRadius: isBottom ? 5 : 0,
    borderTopLeftRadius: isTop ? 5 : 0,
    borderTopRightRadius: isTop ? 5 : 0,
  });
  useEffect(() => {
    setSelectedBar(null);
  }, [selectedYear]);
  const chartData = rows.map((row) => {
    const chlorineUsage = Math.max(0, row.chlorineUsage || 0);
    const peroxideUsage = Math.max(0, row.peroxideUsage || 0);
    const totalMonthUsage = Math.max(0, row.totalUsage || chlorineUsage + peroxideUsage);
    const chemicalStacks = [
      { key: 'chlorine', value: chlorineUsage, color: chlorineColor, textColor: '#FFFFFF' },
      { key: 'peroxide', value: peroxideUsage, color: peroxideColor, textColor: '#11233B' },
    ];

    return {
      label: row.label,
      onPress: () =>
        setSelectedBar({
          title: row.label,
          totalLabel: 'Total',
          totalValue: totalMonthUsage,
          items: [
            { label: 'Chlorine', value: chlorineUsage, color: chlorineColor, iconName: 'water-outline' },
            { label: 'Peroxide', value: peroxideUsage, color: peroxideColor, iconName: 'flask-outline' },
          ],
        }),
      topLabelContainerStyle: totalLabelContainerStyle,
      topLabelComponent: () => renderChemicalTotalLabel(totalMonthUsage),
      stacks: chemicalStacks.map((stack, index) =>
        createChemicalStack({
          ...stack,
          isBottom: index === 0,
          isTop: index === chemicalStacks.length - 1,
        })
      ),
    };
  });
  const chartKey = `monthly-chemical:${selectedYear}:${rows.map((row) => `${row.key}:${row.chlorineUsage || 0}:${row.peroxideUsage || 0}`).join('|')}`;

  return (
    <Card style={[styles.panelCard, cardStyle]}>
      <View style={[styles.chartAppHeader, styles.monthlyProductionHeader]}>
        <ChartTitleFilterGroup
          title="Monthly Chemical Usage"
          iconName="flask-outline"
          palette={palette}
          styles={styles}
        />
      </View>

      <View style={[styles.productionKpiStrip, styles.monthlyProductionKpiStrip, stackChemicalKpi && styles.monthlyProductionKpiStripPhone]}>
        <View style={[styles.productionKpiIcon, stackChemicalKpi && styles.productionKpiIconCompact]}>
          <Ionicons name="flask-outline" size={16} color={palette.teal600} />
        </View>
        <View style={styles.productionKpiCopy}>
          <Text style={styles.productionKpiLabel}>Total Chemicals</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.productionKpiValue}>
            {formatNumber(totalChlorine + totalPeroxide)}
          </Text>
        </View>
        <YearDropdownFilter
          year={selectedYear}
          onChangeYear={onChangeYear}
          isLoading={isLoadingYear}
          accessibilityPrefix="monthly chemical usage"
          header
          style={[styles.monthlyProductionKpiYearPicker, stackChemicalKpi && styles.monthlyProductionKpiYearPickerPhone]}
        />
      </View>

      <View style={styles.productionChart}>
        <BarChart
          key={chartKey}
          stackData={chartData}
          width={chartViewportWidth}
          height={chartHeight}
          barWidth={barWidth}
          spacing={spacing}
          initialSpacing={18}
          endSpacing={18}
          maxValue={chartMaxValue}
          noOfSections={5}
          roundedTop
          roundedBottom={false}
          isAnimated
          animationDuration={800}
          xAxisColor={palette.lineStrong}
          yAxisColor={palette.lineStrong}
          rulesColor={palette.line}
          rulesThickness={1}
          yAxisTextStyle={styles.chartAxisLabel}
          xAxisLabelTextStyle={styles.chartMonthLabel}
          yAxisLabelWidth={58}
          xAxisTextNumberOfLines={1}
          labelsExtraHeight={28}
          formatYLabel={(value) => formatNumber(value, 0)}
          disableScroll={false}
          nestedScrollEnabled
          showScrollIndicator
          indicatorColor={isDark ? 'white' : 'black'}
        />
        {isLoadingYear ? (
          <View style={styles.chartLoadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={palette.teal600} />
            <Text style={styles.chartLoadingText}>Loading {selectedYear}</Text>
          </View>
        ) : null}
      </View>

      <ChartValueDetails selected={selectedBar} styles={styles} />

      <View style={styles.productionLegendRow}>
        <View style={styles.productionLegendItem}>
          <Ionicons name="water-outline" size={13} color={chlorineColor} />
          <View style={[styles.productionLegendSwatch, styles.chemicalLegendChlorine]} />
          <Text style={styles.productionLegendText}>Chlorine</Text>
        </View>
        <View style={styles.productionLegendItem}>
          <Ionicons name="flask-outline" size={13} color={peroxideColor} />
          <View style={[styles.productionLegendSwatch, styles.chemicalLegendPeroxide]} />
          <Text style={styles.productionLegendText}>Peroxide</Text>
        </View>
      </View>

      {!hasData ? (
        <EmptyState
          title="No chemical usage yet"
          body="Monthly chemical usage will appear here after chlorine and peroxide values are saved."
          iconName="flask-outline"
        />
      ) : null}
    </Card>
  );
}

function DailyProductionCard({
  dailyProduction,
  palette,
  isDark,
  isWide,
  screenWidth,
  styles,
  cardStyle,
  selectedMonthDate,
  onChangeMonth,
  isLoadingMonth,
}) {
  const rows = dailyProduction?.rows ?? [];
  const zoomLevel = TABLET_DEFAULT_CHART_ZOOM;
  const [selectedBar, setSelectedBar] = useState(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const selectedYear = selectedMonthDate.getFullYear();
  const selectedMonthIndex = selectedMonthDate.getMonth();
  const selectedMonthKey = `${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, '0')}`;
  const stackDailyControls = screenWidth < 430;
  const stackDailyKpi = screenWidth < 430;
  const totalProduction =
    dailyProduction?.totalProduction ??
    rows.reduce((sum, row) => sum + (Number(row.production) || 0), 0);
  const maxVolume = Math.max(
    ...rows.map((row) => row.production || 0),
    1
  );
  const chartHeight = isWide ? CHART_HEIGHT_WIDE : CHART_HEIGHT_COMPACT;
  const baseBarWidth = isWide ? MONTHLY_BASE_BAR_WIDTH_WIDE : MONTHLY_BASE_BAR_WIDTH_COMPACT;
  const baseSpacing = isWide ? MONTHLY_BASE_SPACING_WIDE : MONTHLY_BASE_SPACING_COMPACT;
  const barWidth = Math.round(baseBarWidth * zoomLevel);
  const spacing = Math.round(baseSpacing * zoomLevel);
  const rawViewportWidth = Math.max(280, screenWidth - (isWide ? 120 : 72));
  const baseContentWidth = Math.max(rows.length * (baseBarWidth + baseSpacing) + 90, isWide ? MONTHLY_CONTENT_WIDTH_WIDE : MONTHLY_CONTENT_WIDTH_COMPACT);
  const chartViewportWidth = Math.min(rawViewportWidth, Math.max(280, baseContentWidth - 120));
  const chartMaxValue = maxVolume <= 0 ? 1 : Math.ceil(maxVolume * 1.18);
  const hasData = rows.some((row) => row.production > 0);
  const valueLabelWidth = Math.round(Math.max(52, Math.min(74, barWidth + 28)));
  const valueLabelFontSize = zoomLevel >= 1.35 ? 10 : 9;
  const topLabelContainerStyle = {
    width: valueLabelWidth,
    height: 18,
    left: (barWidth - valueLabelWidth) / 2,
    justifyContent: 'center',
    alignItems: 'center',
  };
  const selectYear = (year) => {
    onChangeMonth(new Date(year, selectedMonthIndex, 1));
  };
  const selectMonth = (monthIndex) => {
    onChangeMonth(new Date(selectedYear, monthIndex, 1));
    setIsPickerOpen(false);
  };
  useEffect(() => {
    setSelectedBar(null);
    setIsPickerOpen(false);
  }, [selectedMonthKey]);
  const chartData = rows.map((row) => {
    const production = Math.max(0, row.production || 0);
    const productionColor = isDark ? '#1D7896' : '#176A87';

    return {
      value: production,
      label: row.label,
      frontColor: productionColor,
      gradientColor: isDark ? '#36B7D3' : '#4FC3DF',
      onPress: () =>
        setSelectedBar({
          title: row.label,
          items: [{ label: 'Production', value: production, color: productionColor }],
        }),
      topLabelContainerStyle,
      topLabelComponent: () =>
        row.production > 0 ? (
          <View style={styles.chartPlainValueWrap}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.chartPlainValueText, styles.dailyChartPlainValueText, { fontSize: valueLabelFontSize }]}>
              {formatNumber(row.production, 2)}
            </Text>
          </View>
        ) : null,
    };
  });
  const dailyChartKey = `${selectedMonthKey}:${rows.length}:${rows.map((row) => `${row.key}:${row.production || 0}`).join('|')}`;
  const renderDailyDateControls = (inHeader = false) => (
    <View style={[
      styles.dailyHeaderFilterRow,
      styles.dailyDateRail,
      inHeader && styles.dailyHeaderFilterRowHeader,
      inHeader && styles.dailyDateRailHeader,
      !inHeader && !stackDailyControls && styles.dailyHeaderFilterRowCompact,
      !inHeader && stackDailyControls && styles.dailyHeaderFilterRowPhone,
      stackDailyControls && styles.dailyDateRailPhone,
    ]}>
      <View style={[
        styles.dailyPickerWrap,
        inHeader && styles.dailyPickerWrapHeader,
        !inHeader && stackDailyControls && styles.dailyPickerWrapPhone,
      ]}>
        <Pressable
          onPress={() => setIsPickerOpen((current) => !current)}
          disabled={isLoadingMonth}
          accessibilityLabel="Open daily production month picker"
          style={({ pressed }) => [
            styles.dailyPickerButton,
            styles.dailyHeaderPickerButton,
            inHeader && styles.dailyHeaderPickerButtonHeader,
            !inHeader && stackDailyControls && styles.dailyPickerButtonPhone,
            !inHeader && stackDailyControls && styles.dailyHeaderPickerButtonPhone,
            pressed && !isLoadingMonth ? styles.pressed : null,
            isLoadingMonth ? styles.zoomButtonDisabled : null,
          ]}
        >
          <LinearGradient pointerEvents="none" colors={[palette.mist, palette.card]} style={StyleSheet.absoluteFillObject} />
          <Ionicons name="calendar-outline" size={inHeader ? 16 : 15} color={palette.teal600} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={[styles.dailyPickerButtonText, styles.dailyDateMonthText, inHeader && styles.dailyDateMonthTextHeader]}
          >
            {FULL_MONTH_PICKER_LABELS[selectedMonthIndex]}
          </Text>
          {isLoadingMonth ? (
            <ActivityIndicator size="small" color={palette.teal600} />
          ) : (
            <Ionicons name={isPickerOpen ? 'chevron-up' : 'chevron-down'} size={15} color={palette.teal600} />
          )}
        </Pressable>

        {isPickerOpen ? (
          <View
            style={[
              styles.dailyPickerDropdown,
              inHeader && styles.dailyPickerDropdownHeader,
              stackDailyControls && styles.dailyPickerDropdownPhone,
              { width: Math.min(Math.max(screenWidth - 72, 280), 520) },
            ]}
          >
            <View style={styles.dailyPickerDropdownNotch} />
            <View style={styles.dailyPickerMenuHeader}>
              <Text style={styles.dailyPickerMenuTitle}>Select Month</Text>
              <Text style={styles.dailyPickerMenuMeta}>{selectedYear}</Text>
            </View>
            <View style={styles.dailyPickerMenuRule} />
            <View style={styles.dailyMonthMenu}>
              {FULL_MONTH_PICKER_LABELS.map((label, monthIndex) => {
                const isSelected = monthIndex === selectedMonthIndex;

                return (
                  <Pressable
                    key={label}
                    onPress={() => selectMonth(monthIndex)}
                    disabled={isLoadingMonth || isSelected}
                    accessibilityLabel={`Show ${label} ${selectedYear} daily production`}
                    style={({ pressed }) => [
                      styles.dailyMonthOption,
                      stackDailyControls ? styles.dailyMonthOptionPhone : null,
                      isSelected ? styles.dailyMonthOptionActive : null,
                      pressed && !isSelected && !isLoadingMonth ? styles.pressed : null,
                      isLoadingMonth && !isSelected ? styles.zoomButtonDisabled : null,
                    ]}
                  >
                    <Text style={[styles.dailyMonthOptionText, isSelected ? styles.dailyMonthOptionTextActive : null]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.dailyDateRailDivider, stackDailyControls && styles.dailyDateRailDividerPhone]} />

      <View style={[
        styles.dailyDateYearControl,
        inHeader && styles.dailyDateYearControlHeader,
        !inHeader && stackDailyControls && styles.dailyDateYearControlPhone,
      ]}>
        <Pressable
          onPress={() => selectYear(selectedYear - 1)}
          disabled={isLoadingMonth}
          accessibilityLabel={`Show ${selectedYear - 1} daily production`}
          style={({ pressed }) => [
            styles.dailyDateYearNavButton,
            inHeader && styles.dailyDateYearNavButtonHeader,
            !inHeader && stackDailyControls && styles.dailyDateYearNavButtonPhone,
            pressed && !isLoadingMonth ? styles.pressed : null,
            isLoadingMonth ? styles.zoomButtonDisabled : null,
          ]}
        >
          <Ionicons name="chevron-back" size={inHeader ? 17 : 16} color={palette.teal600} />
        </Pressable>
        <View style={styles.dailyDateYearValueWrap}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.dailyDateYearValue, inHeader && styles.dailyDateYearValueHeader]}>
            {selectedYear}
          </Text>
          {isLoadingMonth ? <ActivityIndicator size="small" color={palette.teal600} /> : null}
        </View>
        <Pressable
          onPress={() => selectYear(selectedYear + 1)}
          disabled={isLoadingMonth}
          accessibilityLabel={`Show ${selectedYear + 1} daily production`}
          style={({ pressed }) => [
            styles.dailyDateYearNavButton,
            inHeader && styles.dailyDateYearNavButtonHeader,
            !inHeader && stackDailyControls && styles.dailyDateYearNavButtonPhone,
            pressed && !isLoadingMonth ? styles.pressed : null,
            isLoadingMonth ? styles.zoomButtonDisabled : null,
          ]}
        >
          <Ionicons name="chevron-forward" size={inHeader ? 17 : 16} color={palette.teal600} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <Card style={[styles.panelCard, cardStyle]}>
      <View style={styles.dailyProductionHeader}>
        <View style={styles.dailyTitleZoomRow}>
          <View style={[styles.sectionTitleRow, styles.chartTitleWrap]}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="stats-chart-outline" size={14} color={palette.teal600} />
            </View>
            <Text numberOfLines={2} style={styles.sectionTitle}>Daily Production</Text>
          </View>
        </View>

        <View style={styles.dailyProductionDateRow}>
          {renderDailyDateControls(false)}
        </View>
      </View>

      <View style={[styles.productionKpiStrip, styles.monthlyProductionKpiStrip, stackDailyKpi && styles.monthlyProductionKpiStripPhone]}>
        <View style={[styles.productionKpiIcon, stackDailyKpi && styles.productionKpiIconCompact]}>
          <Ionicons name="calendar-outline" size={16} color={palette.teal600} />
        </View>
        <View style={styles.productionKpiCopy}>
          <Text style={styles.productionKpiLabel}>Month Total</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.productionKpiValue}>
            {formatNumber(totalProduction)}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          style={[styles.productionKpiYear, stackDailyKpi && styles.dailyProductionKpiMonth]}
        >
          {dailyProduction?.monthLabel || 'Current month'}
        </Text>
      </View>

      <View style={styles.productionChart}>
        <BarChart
          key={dailyChartKey}
          data={chartData}
          width={chartViewportWidth}
          height={chartHeight}
          barWidth={barWidth}
          spacing={spacing}
          initialSpacing={18}
          endSpacing={18}
          maxValue={chartMaxValue}
          noOfSections={5}
          showGradient
          roundedBottom={false}
          barBorderTopLeftRadius={5}
          barBorderTopRightRadius={5}
          barBorderBottomLeftRadius={0}
          barBorderBottomRightRadius={0}
          isAnimated
          animationDuration={800}
          showValuesAsTopLabel={false}
          xAxisColor={palette.lineStrong}
          yAxisColor={palette.lineStrong}
          rulesColor={palette.line}
          rulesThickness={1}
          yAxisTextStyle={styles.chartAxisLabel}
          xAxisLabelTextStyle={styles.chartMonthLabel}
          yAxisLabelWidth={56}
          xAxisTextNumberOfLines={1}
          labelsExtraHeight={28}
          formatYLabel={(value) => formatNumber(value, 0)}
          disableScroll={false}
          nestedScrollEnabled
          showScrollIndicator
          indicatorColor={isDark ? 'white' : 'black'}
        />
        {isLoadingMonth ? (
          <View style={styles.chartLoadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={palette.teal600} />
            <Text style={styles.chartLoadingText}>Loading {createMonthYearLabel(selectedMonthDate)}</Text>
          </View>
        ) : null}
      </View>

      <ChartValueDetails selected={selectedBar} styles={styles} />

      <View style={styles.productionLegendRow}>
        <View style={styles.productionLegendItem}>
          <View style={[styles.productionLegendSwatch, styles.productionLegendProduction]} />
          <Text style={styles.productionLegendText}>Production</Text>
        </View>
      </View>

      {!hasData ? (
        <EmptyState
          title="No daily production yet"
          body="Daily production will appear here after records are available for the selected month."
          iconName="calendar-outline"
        />
      ) : null}
    </Card>
  );
}

export default function OfficeGraphsScreen({ navigation }) {
  const { palette, isDark } = useTheme();
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const responsiveMetrics = useMemo(() => getResponsiveMetrics(width), [width]);
  const styles = useMemo(() => createStyles(palette, isDark, responsiveMetrics), [palette, isDark, responsiveMetrics]);
  const isWide = width >= 980;
  const useTwoColumnCharts = width >= 980;
  const shellContentWidth = Math.max(
    320,
    Math.min(width, responsiveMetrics.contentMaxWidth || width) - (responsiveMetrics.contentPadding * 2)
  );
  const chartCardWidth = useTwoColumnCharts ? Math.floor((shellContentWidth - 12) / 2) : shellContentWidth;
  const [monthlyProduction, setMonthlyProduction] = useState({
    totalProduction: 0,
    averageProduction: 0,
    rows: [],
  });
  const [monthlyChartsYear, setMonthlyChartsYear] = useState(() => new Date().getFullYear());
  const [monthlyChartsLoading, setMonthlyChartsLoading] = useState(false);
  const [monthlyPowerConsumption, setMonthlyPowerConsumption] = useState({
    totalPower: 0,
    rows: [],
  });
  const [monthlyChemicalUsage, setMonthlyChemicalUsage] = useState({
    totalChlorine: 0,
    totalPeroxide: 0,
    rows: [],
  });
  const [dailyProduction, setDailyProduction] = useState({
    monthLabel: '',
    totalProduction: 0,
    rows: [],
  });
  const [dailyProductionMonth, setDailyProductionMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dailyProductionLoading, setDailyProductionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportingFormat, setExportingFormat] = useState('');
  const [selectedExportFormat, setSelectedExportFormat] = useState('pdf');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState('info');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [headerAlertCount, setHeaderAlertCount] = useState(0);
  const scrollViewRef = useRef(null);
  const scrollTopOpacity = useRef(new Animated.Value(0)).current;
  const [showScrollTop, setShowScrollTop] = useState(false);
  const canExportAnalytics = ['manager', 'supervisor', 'general_manager'].includes(profile?.role);

  async function loadGraphs({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }

    try {
      const snapshot = await getOfficeDashboardSnapshot();
      const selectedMonthlyAnalytics = await getMonthlyAnalyticsForYear({ year: monthlyChartsYear });
      const now = new Date();
      const selectedDailyProduction =
        dailyProductionMonth.getFullYear() === now.getFullYear() && dailyProductionMonth.getMonth() === now.getMonth()
          ? snapshot.dailyProduction
          : await getDailyProductionForMonth({
              year: dailyProductionMonth.getFullYear(),
              monthIndex: dailyProductionMonth.getMonth(),
            });
      setMonthlyProduction(selectedMonthlyAnalytics.monthlyProduction || snapshot.monthlyProduction);
      setDailyProduction(selectedDailyProduction || { monthLabel: '', totalProduction: 0, rows: [] });
      setMonthlyChemicalUsage(selectedMonthlyAnalytics.monthlyChemicalUsage || snapshot.monthlyChemicalUsage || { totalChlorine: 0, totalPeroxide: 0, rows: [] });
      setMonthlyPowerConsumption(selectedMonthlyAnalytics.monthlyPowerConsumption || snapshot.monthlyPowerConsumption || { totalPower: 0, rows: [] });
      setHeaderAlertCount(snapshot.pendingApprovals?.length || 0);
      setLastUpdatedAt(new Date());
      setTone('success');
      setMessage('Dashboard graphs are synced with the live database.');
    } catch (error) {
      setTone('error');
      setMessage(error.message || 'Failed to load dashboard graphs.');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function handleChangeDailyProductionMonth(nextDate) {
    const nextMonth = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
    setDailyProductionMonth(nextMonth);
    setDailyProduction(createDailyProductionPlaceholder(nextMonth));
    setDailyProductionLoading(true);

    try {
      const nextDailyProduction = await getDailyProductionForMonth({
        year: nextMonth.getFullYear(),
        monthIndex: nextMonth.getMonth(),
      });
      setDailyProduction(nextDailyProduction);
      setLastUpdatedAt(new Date());
      setTone('success');
      setMessage(`Daily production is showing ${nextDailyProduction.monthLabel}.`);
    } catch (error) {
      setTone('error');
      setMessage(error.message || 'Failed to load daily production for the selected month.');
    } finally {
      setDailyProductionLoading(false);
    }
  }

  async function handleChangeMonthlyChartsYear(nextYear) {
    const parsedYear = Number(nextYear);
    if (!Number.isInteger(parsedYear)) {
      return;
    }

    const placeholder = createMonthlyAnalyticsPlaceholder(parsedYear);
    setMonthlyChartsYear(parsedYear);
    setMonthlyProduction(placeholder.monthlyProduction);
    setMonthlyPowerConsumption(placeholder.monthlyPowerConsumption);
    setMonthlyChemicalUsage(placeholder.monthlyChemicalUsage);
    setMonthlyChartsLoading(true);

    try {
      const nextAnalytics = await getMonthlyAnalyticsForYear({ year: parsedYear });
      setMonthlyProduction(nextAnalytics.monthlyProduction);
      setMonthlyPowerConsumption(nextAnalytics.monthlyPowerConsumption);
      setMonthlyChemicalUsage(nextAnalytics.monthlyChemicalUsage);
      setLastUpdatedAt(new Date());
      setTone('success');
      setMessage(`Monthly charts are showing ${parsedYear}.`);
    } catch (error) {
      setTone('error');
      setMessage(error.message || 'Failed to load monthly charts for the selected year.');
    } finally {
      setMonthlyChartsLoading(false);
    }
  }

  useEffect(() => {
    loadGraphs();
  }, []);

  useEffect(() => {
    Animated.timing(scrollTopOpacity, {
      toValue: showScrollTop ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [scrollTopOpacity, showScrollTop]);

  function handleGraphScroll(event) {
    const offsetY = event?.nativeEvent?.contentOffset?.y || 0;
    const shouldShow = offsetY > 420;
    if (showScrollTop !== shouldShow) {
      setShowScrollTop(shouldShow);
    }
  }

  function handleScrollToTop() {
    scrollViewRef.current?.scrollTo?.({ y: 0, animated: true });
  }

  async function handleExportAnalytics(format) {
    if (!canExportAnalytics) {
      setTone('error');
      setMessage('Only managers, supervisors, and general managers can export analytics.');
      return;
    }

    const sections = buildAnalyticsExportSections({
      monthlyProduction,
      monthlyPowerConsumption,
      monthlyChemicalUsage,
    });
    const hasRows = sections.some((section) => section.title !== 'Summary' && section.rows.length);

    if (!hasRows) {
      setTone('info');
      setMessage('Load monthly analytics data before exporting.');
      return;
    }

    setExportingFormat(format);
    setTone('info');
    setMessage(`Preparing ${format.toUpperCase()} export...`);

    try {
      let exportResult = null;

      if (format === 'xlsx') {
        const workbook = XLSX.utils.book_new();
        sections.forEach((section) => {
          const worksheet = XLSX.utils.aoa_to_sheet(buildSheetRows(section.columns, section.rows));
          XLSX.utils.book_append_sheet(workbook, worksheet, section.sheetName);
        });

        const fileName = buildExportFileName('xlsx');

        if (Platform.OS === 'web') {
          const workbookArray = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob(
            [workbookArray],
            { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
          );
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', fileName);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } else {
          exportResult = await saveNativeExportFile({
            fileName,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Export monthly analytics Excel file',
            uti: 'org.openxmlformats.spreadsheetml.sheet',
            base64Content: XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' }),
            shareMessage: 'Monthly analytics Excel export is ready.',
          });
        }
      } else {
        const fileName = buildExportFileName('pdf');
        const html = buildAnalyticsPdfDocument(sections);

        if (Platform.OS === 'web') {
          const printWindow = window.open('', '_blank');

          if (!printWindow) {
            throw new Error('Unable to open a print window for PDF export.');
          }

          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
        } else {
          const { uri: fileUri } = await Print.printToFileAsync({
            html,
            base64: false,
          });

          exportResult = await saveNativeExportFile({
            fileName,
            mimeType: 'application/pdf',
            dialogTitle: 'Export monthly analytics PDF',
            uti: 'com.adobe.pdf',
            localUri: fileUri,
            shareMessage: 'Monthly analytics PDF export is ready.',
          });
        }
      }

      setTone('success');
      setMessage(buildNativeExportSuccessMessage(format, exportResult));
    } catch (error) {
      setTone('error');
      setMessage(error.message || `Failed to export ${format.toUpperCase()}.`);
    } finally {
      setExportingFormat('');
    }
  }

  const headerStatusChips = [
    {
      key: 'connected',
      label: tone === 'error' ? 'Connection issue' : 'Connected',
      tone: tone === 'error' ? 'warning' : 'success',
      iconName: tone === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline',
      iconColor: tone === 'error' ? palette.amber500 : palette.successText,
    },
    {
      key: 'alerts',
      label: `${headerAlertCount} alerts`,
      tone: headerAlertCount ? 'warning' : 'neutral',
      iconName: headerAlertCount ? 'warning-outline' : 'notifications-outline',
      iconColor: headerAlertCount ? palette.amber500 : palette.ink500,
    },
    {
      key: 'updated',
      label: `Updated ${formatHeaderUpdatedTime(lastUpdatedAt)}`,
      tone: 'neutral',
      iconName: 'ellipse',
      iconColor: palette.teal500,
    },
  ];

  return (
    <ScreenShell
      eyebrow="Live Supabase Workspace"
      title="Graphs"
      showMenuButton
      stickyHeader
      statusChips={headerStatusChips}
      refreshing={loading}
      onRefresh={() => loadGraphs()}
      scrollRef={scrollViewRef}
      onScroll={handleGraphScroll}
      scrollEventThrottle={16}
      floatingOverlay={
        <Animated.View
          pointerEvents={showScrollTop ? 'auto' : 'none'}
          style={[
            styles.scrollTopButtonWrap,
            {
              opacity: scrollTopOpacity,
              transform: [
                {
                  translateY: scrollTopOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            onPress={handleScrollToTop}
            accessibilityRole="button"
            accessibilityLabel="Scroll to top"
            style={({ pressed }) => [styles.scrollTopButton, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-up" size={22} color={palette.onAccent} />
          </Pressable>
        </Animated.View>
      }
    >
      <View style={styles.topPillRow}>
        {canExportAnalytics ? (
          <View style={styles.topRightActionGroup}>
            <SplitExportButton
              format={selectedExportFormat}
              options={GRAPH_EXPORT_OPTIONS}
              loading={Boolean(exportingFormat)}
              disabled={loading}
              onExport={() => handleExportAnalytics(selectedExportFormat)}
              onSelectFormat={setSelectedExportFormat}
              size="compact"
              showFormatLabel={false}
              compactMenu
              style={styles.graphSplitExport}
            />
          </View>
        ) : null}
      </View>

      {loading ? (
        <GraphSkeletonGrid styles={styles} useTwoColumnCharts={useTwoColumnCharts} />
      ) : (
        <View style={styles.chartGrid}>
          <MonthlyProductionCard
            monthlyProduction={monthlyProduction}
            palette={palette}
            isDark={isDark}
            isWide={isWide}
            screenWidth={chartCardWidth}
            styles={styles}
            cardStyle={useTwoColumnCharts ? styles.chartGridCard : null}
            selectedYear={monthlyChartsYear}
            onChangeYear={handleChangeMonthlyChartsYear}
            isLoadingYear={monthlyChartsLoading}
          />
          <DailyProductionCard
            dailyProduction={dailyProduction}
            palette={palette}
            isDark={isDark}
            isWide={isWide}
            screenWidth={chartCardWidth}
            styles={styles}
            cardStyle={useTwoColumnCharts ? styles.chartGridCard : null}
            selectedMonthDate={dailyProductionMonth}
            onChangeMonth={handleChangeDailyProductionMonth}
            isLoadingMonth={dailyProductionLoading}
          />
          <MonthlyPowerConsumptionCard
            monthlyPowerConsumption={monthlyPowerConsumption}
            palette={palette}
            isDark={isDark}
            isWide={isWide}
            screenWidth={chartCardWidth}
            styles={styles}
            cardStyle={useTwoColumnCharts ? styles.chartGridCard : null}
            selectedYear={monthlyChartsYear}
            onChangeYear={handleChangeMonthlyChartsYear}
            isLoadingYear={monthlyChartsLoading}
          />
          <MonthlyChemicalUsageCard
            monthlyChemicalUsage={monthlyChemicalUsage}
            palette={palette}
            isDark={isDark}
            isWide={isWide}
            screenWidth={chartCardWidth}
            styles={styles}
            cardStyle={useTwoColumnCharts ? styles.chartGridCard : null}
            selectedYear={monthlyChartsYear}
            onChangeYear={handleChangeMonthlyChartsYear}
            isLoadingYear={monthlyChartsLoading}
          />
        </View>
      )}
    </ScreenShell>
  );
}

function createStyles(palette, isDark, responsiveMetrics) {
  return StyleSheet.create(scaleStyleDefinitions({
    topPillRow: {
      position: 'relative',
      zIndex: 110,
      elevation: 110,
      flexDirection: 'row',
      flexWrap: responsiveMetrics.width < 520 ? 'wrap' : 'nowrap',
      alignItems: 'stretch',
      justifyContent: 'space-between',
      gap: 8,
    },
    topRightActionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      marginLeft: 'auto',
      flexShrink: 0,
    },
    graphSplitExport: {
      flex: 1,
      maxWidth: responsiveMetrics.isTablet ? 176 : 120,
    },
    scrollTopButtonWrap: {
      position: 'absolute',
      right: responsiveMetrics.isTablet ? 28 : 18,
      bottom: responsiveMetrics.isTablet ? 28 : 20,
      zIndex: 1500,
      elevation: 1500,
    },
    scrollTopButton: {
      width: 50,
      height: 50,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#2DD4BF' : '#0F766E',
      backgroundColor: palette.navy700,
      borderRadius: 999,
      shadowColor: isDark ? '#00D6D0' : '#0F766E',
      shadowOpacity: isDark ? 0.28 : 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    pressed: {
      transform: [{ scale: 0.98 }],
    },
    loadingWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
    },
    chartGrid: {
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      alignItems: 'stretch',
      justifyContent: 'center',
    },
    chartGridCard: {
      flexBasis: '48%',
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    panelCard: {
      width: '100%',
      gap: 12,
      padding: 12,
      overflow: 'visible',
    },
    skeletonBlock: {
      backgroundColor: isDark ? '#1C3346' : '#E5EEF6',
      borderRadius: 8,
    },
    skeletonHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    skeletonIcon: {
      width: 24,
      height: 24,
      borderRadius: 999,
    },
    skeletonTitleLine: {
      width: 170,
      maxWidth: '72%',
      height: 16,
    },
    skeletonMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      justifyContent: 'space-between',
      gap: 8,
    },
    skeletonSummaryPill: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 170,
      height: 54,
    },
    skeletonToolbarPill: {
      width: 150,
      height: 54,
    },
    skeletonChartArea: {
      minHeight: 292,
      flexDirection: 'row',
      gap: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#0B1723' : '#FBFDFF',
      paddingHorizontal: 12,
      paddingTop: 24,
      paddingBottom: 16,
      borderRadius: 8,
    },
    skeletonChartAreaTall: {
      minHeight: CHART_CONTAINER_MIN_HEIGHT,
    },
    skeletonAxisColumn: {
      width: 36,
      justifyContent: 'space-between',
      paddingBottom: 28,
    },
    skeletonAxisTick: {
      width: 28,
      height: 8,
      borderRadius: 4,
    },
    skeletonBarsRow: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 8,
    },
    skeletonBarSlot: {
      flex: 1,
      minWidth: 12,
      maxWidth: 34,
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
    },
    skeletonBar: {
      width: '100%',
      maxWidth: 26,
      borderRadius: 5,
    },
    skeletonBarSegmentTop: {
      width: '100%',
      maxWidth: 26,
      borderTopLeftRadius: 5,
      borderTopRightRadius: 5,
      borderBottomLeftRadius: 2,
      borderBottomRightRadius: 2,
    },
    skeletonBarSegmentBottom: {
      width: '100%',
      maxWidth: 26,
      borderTopLeftRadius: 2,
      borderTopRightRadius: 2,
      borderBottomLeftRadius: 5,
      borderBottomRightRadius: 5,
    },
    skeletonBarLabel: {
      width: '80%',
      height: 8,
      borderRadius: 4,
    },
    skeletonLegendRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 10,
    },
    skeletonLegendItem: {
      width: 104,
      height: 18,
      borderRadius: 8,
    },
    sectionHeader: {
      gap: 3,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    chartTitleWrap: {
      flex: 1,
      minWidth: 0,
      flexShrink: 1,
    },
    sectionIconWrap: {
      width: 24,
      height: 24,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#16304A' : '#EAF2FB',
      borderWidth: 1,
      borderColor: isDark ? '#31506E' : '#C9DDF3',
    },
    sectionTitle: {
      flexShrink: 1,
      minWidth: 0,
      color: palette.ink900,
      fontSize: 16,
      fontWeight: '800',
    },
    sectionBody: {
      color: palette.ink700,
      fontSize: 12,
      lineHeight: 16,
    },
    dailyCardHeader: {
      position: 'relative',
      zIndex: 80,
      elevation: 80,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
    },
    dailyCardHeaderPhone: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    dailyProductionHeader: {
      position: 'relative',
      zIndex: 80,
      elevation: 80,
      gap: 10,
    },
    dailyProductionDateRow: {
      width: '100%',
      alignItems: responsiveMetrics.isTablet ? 'stretch' : 'flex-start',
    },
    dailyTitleZoomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    chartTitleFilterGroup: {
      flex: 1,
      minWidth: 0,
      flexShrink: 1,
      gap: 8,
      zIndex: 90,
      elevation: 90,
    },
    chartYearStandaloneRow: {
      position: 'relative',
      zIndex: 70,
      elevation: 70,
      width: '100%',
      alignItems: 'stretch',
      marginTop: -2,
    },
    chartYearCompactItem: {
      position: 'relative',
      zIndex: 70,
      elevation: 70,
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 156,
      minWidth: 136,
      maxWidth: 220,
      alignItems: 'stretch',
    },
    chartYearHeaderRow: {
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      height: 30,
    },
    dailyHeaderFilterRow: {
      position: 'relative',
      zIndex: 35,
      elevation: 35,
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    dailyDateRail: {
      maxWidth: responsiveMetrics.isTablet ? '100%' : 360,
      minHeight: 54,
      overflow: 'visible',
      borderWidth: 1,
      borderColor: isDark ? '#2A536D' : '#A9DCE5',
      backgroundColor: isDark ? '#0A1724' : '#F1FAFD',
      paddingHorizontal: 7,
      paddingVertical: 5,
      borderRadius: 12,
      shadowColor: isDark ? '#16D7DF' : '#0F6E91',
      shadowOpacity: isDark ? 0.14 : 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
    },
    dailyDateRailHeader: {
      maxWidth: 390,
      minHeight: 40,
      paddingHorizontal: 5,
      paddingVertical: 5,
      borderRadius: 13,
    },
    dailyDateRailPhone: {
      maxWidth: '100%',
      minHeight: 42,
      paddingHorizontal: 5,
      paddingVertical: 4,
    },
    dailyDateRailDivider: {
      width: 1,
      alignSelf: 'stretch',
      backgroundColor: isDark ? '#27445D' : '#BFDDEB',
      opacity: 0.95,
      marginHorizontal: 4,
    },
    dailyDateRailDividerPhone: {
      width: 1,
      height: 'auto',
      marginHorizontal: 2,
      marginVertical: 0,
    },
    dailyHeaderFilterRowHeader: {
      width: 'auto',
      flexShrink: 0,
      height: 'auto',
      marginLeft: 0,
      justifyContent: 'flex-end',
      gap: 6,
    },
    dailyHeaderFilterRowCompact: {
      width: '100%',
      flexGrow: 1,
      flexShrink: 1,
      justifyContent: 'flex-start',
    },
    dailyHeaderFilterRowPhone: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 0,
      gap: 6,
    },
    chartMetaRow: {
      position: 'relative',
      zIndex: 20,
      elevation: 20,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      justifyContent: 'space-between',
      gap: 8,
    },
    chartMetaRowCompact: {
      flexDirection: 'column',
    },
    dailyMetaStack: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    dailyProductionSummaryPill: {
      width: responsiveMetrics.isTablet || responsiveMetrics.width < 430 ? '100%' : undefined,
      maxWidth: responsiveMetrics.isTablet || responsiveMetrics.width < 430 ? '100%' : 180,
      alignSelf: responsiveMetrics.isTablet || responsiveMetrics.width < 430 ? 'stretch' : 'flex-start',
    },
    dailyControlRow: {
      width: '100%',
      position: 'relative',
      zIndex: 30,
      elevation: 30,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    dailyControlRowPhone: {
      flexWrap: 'wrap',
      alignItems: 'stretch',
      justifyContent: 'center',
    },
    dailyDatePickerBar: {
      flexGrow: 2.6,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 260,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: isDark ? '#254A66' : '#CFE2F3',
      backgroundColor: isDark ? '#0C1824' : '#F6FBFF',
      paddingHorizontal: 6,
      paddingVertical: 6,
      borderRadius: 12,
    },
    dailyDatePickerBarPhone: {
      flexBasis: '100%',
      minWidth: 0,
      flexWrap: 'nowrap',
      gap: 6,
    },
    dailyDateDivider: {
      width: 1,
      alignSelf: 'stretch',
      backgroundColor: isDark ? '#24445F' : '#D7E6F2',
      opacity: 0.9,
    },
    dailyDateDividerPhone: {
      display: 'flex',
    },
    chartAppHeader: {
      position: 'relative',
      zIndex: 80,
      elevation: 80,
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
    },
    monthlyProductionHeader: {
      minHeight: 28,
      alignItems: 'center',
      marginBottom: -2,
    },
    chartAppHeaderCompact: {
      alignItems: 'stretch',
      flexDirection: 'column',
      gap: 8,
    },
    chartCompactControlsRow: {
      position: 'relative',
      zIndex: 70,
      elevation: 70,
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    chartCompactControlsRowPhone: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    chartHeaderControls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
    },
    chartHeaderControlsCompact: {
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: 6,
    },
    yearInlineControl: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#101D2A' : '#F9FCFF',
      paddingHorizontal: 6,
      paddingVertical: 4,
      borderRadius: 8,
    },
    monthlyProductionYearControl: {
      minHeight: 40,
      justifyContent: 'space-between',
      borderColor: isDark ? '#1D8C91' : '#B5E5E3',
      backgroundColor: isDark ? '#0F2B35' : '#F0FBFA',
      borderRadius: 10,
    },
    monthlyProductionYearRow: {
      width: '100%',
      alignItems: 'center',
    },
    chartYearFilterRow: {
      position: 'relative',
      zIndex: 25,
      elevation: 25,
      width: '100%',
      alignItems: 'flex-start',
      marginTop: -4,
    },
    zoomInlineControl: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#101D2A' : '#F9FCFF',
      paddingHorizontal: 6,
      paddingVertical: 4,
      borderRadius: 8,
    },
    headerIconButton: {
      width: 26,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#152636' : '#F7FBFF',
      borderRadius: 7,
    },
    yearInlineValue: {
      minWidth: 48,
      color: palette.ink900,
      fontSize: 13,
      fontWeight: '900',
      textAlign: 'center',
    },
    zoomInlineValueButton: {
      minWidth: 58,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#1A655E' : '#B4E5DE',
      backgroundColor: isDark ? '#11312D' : '#E5F5F3',
      paddingHorizontal: 7,
      borderRadius: 7,
    },
    productionKpiStrip: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderColor: isDark ? '#1E5B61' : '#B7E2E4',
      backgroundColor: isDark ? '#102735' : '#F2FCFC',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
    },
    monthlyProductionKpiStrip: {
      minHeight: 62,
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
    },
    monthlyProductionKpiStripPhone: {
      flexWrap: 'wrap',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 9,
    },
    monthlyProductionKpiYearPicker: {
      flexGrow: 0,
      flexShrink: 0,
      width: 112,
      maxWidth: 112,
      height: 32,
      minHeight: 32,
      borderRadius: 999,
      borderColor: isDark ? '#1D8C91' : '#8ADCD6',
      backgroundColor: isDark ? '#0F2B35' : '#F0FBFA',
    },
    monthlyProductionKpiYearPickerPhone: {
      flexBasis: '100%',
      width: responsiveMetrics.width < 380 ? 92 : 104,
      maxWidth: responsiveMetrics.width < 380 ? 92 : 104,
      height: 28,
      minHeight: 28,
      alignSelf: 'flex-end',
      marginTop: 2,
    },
    productionKpiStripCompact: {
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    productionKpiIcon: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#26786F' : '#9ADBD5',
      backgroundColor: isDark ? '#0E3A37' : '#DDF7F4',
      borderRadius: 8,
    },
    productionKpiIconCompact: {
      width: 32,
      height: 32,
    },
    productionKpiCopy: {
      flex: 1,
      minWidth: 0,
    },
    productionKpiLabel: {
      color: palette.ink700,
      fontSize: 10,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    productionKpiValue: {
      marginTop: 2,
      color: isDark ? palette.ink900 : palette.navy900,
      fontSize: 20,
      fontWeight: '900',
      lineHeight: 24,
    },
    productionKpiYear: {
      color: palette.ink700,
      fontSize: 14,
      fontWeight: '900',
    },
    dailyProductionKpiMonth: {
      flexBasis: '100%',
      textAlign: 'right',
      fontSize: 12,
      marginTop: 2,
    },
    chartControlRow: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 320,
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'flex-end',
      gap: 6,
    },
    chartControlRowCompact: {
      width: '100%',
      minWidth: 0,
      flexDirection: 'column',
    },
    productionSummaryPill: {
      position: 'relative',
      overflow: 'hidden',
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minWidth: 0,
      flexGrow: 1,
      flexShrink: 1,
      borderWidth: 1,
      borderColor: isDark ? '#1E5B61' : '#B7E2E4',
      backgroundColor: isDark ? '#122334' : '#F2FCFC',
      paddingLeft: 16,
      paddingRight: 14,
      paddingVertical: 12,
      borderRadius: 8,
      shadowColor: isDark ? '#000000' : '#0F766E',
      shadowOpacity: isDark ? 0.22 : 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    productionSummaryPillWide: {
      maxWidth: 360,
    },
    productionSummaryAccent: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 5,
      backgroundColor: palette.teal600,
    },
    productionSummaryIcon: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#26786F' : '#9ADBD5',
      backgroundColor: isDark ? '#0E3A37' : '#DDF7F4',
      borderRadius: 8,
    },
    productionSummaryCopy: {
      flex: 1,
      minWidth: 0,
    },
    productionSummaryLabel: {
      color: palette.ink700,
      fontSize: 10,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    productionSummaryValue: {
      marginTop: 2,
      color: isDark ? palette.ink900 : palette.navy900,
      fontSize: 22,
      fontWeight: '900',
      lineHeight: 26,
    },
    productionSummaryHint: {
      marginTop: 1,
      color: palette.ink500,
      fontSize: 9,
      fontWeight: '800',
    },
    chartToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      minHeight: 44,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#101D2A' : '#F9FCFF',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
    },
    chartToolbarCompact: {
      width: '100%',
    },
    chartToolbarInControlRow: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 160,
    },
    monthPickerPanel: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 260,
      minHeight: 116,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#101D2A' : '#F9FCFF',
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 8,
      gap: 8,
    },
    monthPickerPanelCompact: {
      width: '100%',
    },
    dailyPickerWrap: {
      position: 'relative',
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 124,
      zIndex: 50,
      elevation: 50,
    },
    dailyPickerWrapHeader: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 118,
      width: 'auto',
    },
    dailyPickerWrapPhone: {
      flexGrow: 1.7,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 124,
    },
    dailyPickerWrapCompact: {
      width: '100%',
    },
    dailyPickerButton: {
      position: 'relative',
      overflow: 'hidden',
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      borderWidth: 1,
      borderColor: isDark ? '#1D8C91' : '#8ADCD6',
      backgroundColor: isDark ? '#112334' : '#F8FCFF',
      paddingHorizontal: 10,
      paddingVertical: 0,
      borderRadius: 8,
      shadowColor: isDark ? '#15D5DF' : '#0EA5B7',
      shadowOpacity: isDark ? 0.1 : 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    dailyPickerButtonPhone: {
      minHeight: 34,
    },
    dailyPickerButtonText: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 40,
      color: palette.ink900,
      fontSize: 14,
      fontWeight: '900',
    },
    dailyDateMonthText: {
      fontSize: 14,
      lineHeight: 17,
    },
    dailyDateMonthTextHeader: {
      fontSize: 13,
      lineHeight: 16,
    },
    dailyHeaderPickerButton: {
      minHeight: 44,
      width: '100%',
      maxWidth: '100%',
    },
    dailyHeaderPickerButtonPhone: {
      minHeight: 34,
    },
    dailyHeaderPickerButtonHeader: {
      minHeight: 36,
      height: 36,
      borderRadius: 11,
      paddingHorizontal: 10,
      gap: 7,
    },
    dailyDateYearControl: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 152,
      maxWidth: 188,
      height: 44,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      borderColor: isDark ? '#1D8C91' : '#8ADCD6',
      borderWidth: 1,
      backgroundColor: isDark ? '#112334' : '#F8FCFF',
      borderRadius: 8,
      paddingHorizontal: 6,
      shadowColor: isDark ? '#15D5DF' : '#0EA5B7',
      shadowOpacity: isDark ? 0.1 : 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    dailyDateYearControlHeader: {
      minWidth: 132,
      maxWidth: 160,
      height: 36,
      minHeight: 36,
      borderRadius: 11,
      paddingHorizontal: 5,
      gap: 5,
    },
    dailyDateYearControlPhone: {
      width: 'auto',
      flexGrow: 0.9,
      minWidth: 118,
      maxWidth: 140,
      height: 34,
      minHeight: 34,
    },
    dailyDateYearNavButton: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#284E68' : '#B7DAE9',
      backgroundColor: isDark ? '#14283B' : '#FFFFFF',
      borderRadius: 8,
      shadowColor: isDark ? '#15D5DF' : '#0EA5B7',
      shadowOpacity: isDark ? 0.14 : 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    dailyDateYearNavButtonHeader: {
      width: 28,
      height: 28,
      borderRadius: 9,
    },
    dailyDateYearNavButtonPhone: {
      width: 26,
      height: 26,
      borderRadius: 7,
    },
    dailyDateYearValueWrap: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    dailyDateYearValue: {
      color: palette.ink900,
      fontSize: 14,
      lineHeight: 17,
      fontWeight: '900',
      textAlign: 'center',
    },
    dailyDateYearValueHeader: {
      fontSize: 15,
      lineHeight: 18,
    },
    dailyPickerDropdown: {
      position: 'absolute',
      left: 0,
      top: 58,
      gap: 12,
      borderWidth: 1,
      borderColor: isDark ? '#246080' : '#B8DDF0',
      backgroundColor: isDark ? '#081522' : '#F8FCFF',
      paddingHorizontal: 14,
      paddingTop: 18,
      paddingBottom: 14,
      borderRadius: 14,
      shadowColor: isDark ? '#00D6D0' : '#0F6E91',
      shadowOpacity: isDark ? 0.24 : 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      elevation: 60,
      zIndex: 60,
    },
    dailyPickerDropdownHeader: {
      top: 40,
    },
    dailyPickerDropdownPhone: {
      left: -2,
      paddingHorizontal: 12,
    },
    dailyPickerDropdownNotch: {
      position: 'absolute',
      top: -10,
      left: 26,
      width: 20,
      height: 20,
      borderLeftWidth: 1,
      borderTopWidth: 1,
      borderColor: isDark ? '#246080' : '#B8DDF0',
      backgroundColor: isDark ? '#081522' : '#F8FCFF',
      transform: [{ rotate: '45deg' }],
      borderTopLeftRadius: 4,
    },
    dailyPickerMenuHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 2,
    },
    dailyPickerMenuTitle: {
      color: isDark ? '#9DB9CB' : '#52738B',
      fontSize: 12,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0,
    },
    dailyPickerMenuMeta: {
      color: palette.ink900,
      fontSize: 16,
      fontWeight: '900',
    },
    dailyPickerMenuRule: {
      height: 1,
      backgroundColor: isDark ? '#24445F' : '#D7E6F2',
      opacity: 0.9,
    },
    dailyYearInlineControl: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 118,
      minHeight: 40,
      justifyContent: 'space-between',
      borderColor: isDark ? '#1D8C91' : '#B5E5E3',
      backgroundColor: isDark ? '#0F2B35' : '#F0FBFA',
      borderRadius: 10,
    },
    dailyYearInlineControlPhone: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 146,
      minWidth: 136,
      minHeight: 44,
      justifyContent: 'center',
      gap: 6,
    },
    dailyDateYearText: {
      color: palette.ink900,
      fontSize: 15,
      lineHeight: 18,
    },
    dailyDateArrowButton: {
      width: 32,
      height: 32,
      borderColor: isDark ? '#254A66' : '#CFE2F3',
      backgroundColor: isDark ? '#142638' : '#F8FCFF',
      borderRadius: 9,
    },
    dailyDateArrowButtonPhone: {
      width: 44,
      height: 44,
    },
    dailyYearInlineControlCompact: {
      alignSelf: 'center',
    },
    dailyMonthMenu: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    dailyMonthOption: {
      width: '23%',
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#23516D' : '#BFD9EA',
      backgroundColor: isDark ? '#0D1C2B' : '#FFFFFF',
      paddingHorizontal: 6,
      borderRadius: 9,
    },
    dailyMonthOptionPhone: {
      width: '48%',
    },
    dailyMonthOptionActive: {
      borderColor: isDark ? '#22E4DC' : '#42C7C5',
      backgroundColor: isDark ? '#0B7774' : '#D7F8F5',
      shadowColor: '#14DAD2',
      shadowOpacity: isDark ? 0.36 : 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    dailyMonthOptionText: {
      color: palette.ink900,
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
    },
    dailyMonthOptionTextActive: {
      color: isDark ? '#FFFFFF' : '#064E4B',
      fontWeight: '900',
    },
    yearPickerPanel: {
      flexGrow: 0,
      flexShrink: 0,
      minWidth: 150,
      minHeight: 44,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#101D2A' : '#F9FCFF',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
      gap: 4,
    },
    yearPickerPanelCompact: {
      width: '100%',
    },
    monthPickerHeader: {
      minHeight: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    yearPickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    yearPickerValue: {
      minWidth: 54,
      color: palette.ink900,
      fontSize: 14,
      fontWeight: '900',
      textAlign: 'center',
    },
    monthPickerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 6,
    },
    monthPickerChip: {
      width: 45,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#152636' : '#F7FBFF',
      borderRadius: 8,
    },
    monthPickerChipActive: {
      borderColor: isDark ? '#1A655E' : '#B4E5DE',
      backgroundColor: isDark ? '#11312D' : '#E5F5F3',
    },
    monthPickerChipText: {
      color: palette.ink700,
      fontSize: 10,
      fontWeight: '900',
    },
    monthPickerChipTextActive: {
      color: palette.ink900,
    },
    chartToolbarLabel: {
      color: palette.ink700,
      fontSize: 9,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    zoomControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    zoomButton: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#152636' : '#F7FBFF',
      borderRadius: 8,
    },
    zoomButtonDisabled: {
      opacity: 0.45,
    },
    zoomValueButton: {
      minWidth: 62,
      height: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: isDark ? '#1A655E' : '#B4E5DE',
      backgroundColor: isDark ? '#11312D' : '#E5F5F3',
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    productionChart: {
      overflow: 'hidden',
      position: 'relative',
      zIndex: 0,
      elevation: 0,
      alignItems: 'center',
      minHeight: CHART_CONTAINER_MIN_HEIGHT,
      paddingTop: 20,
      paddingRight: 10,
      paddingBottom: 6,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#0B1723' : '#FBFDFF',
      borderRadius: 8,
    },
    chartLoadingOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: isDark ? 'rgba(11, 23, 35, 0.78)' : 'rgba(251, 253, 255, 0.82)',
      borderRadius: 8,
    },
    chartLoadingText: {
      color: palette.ink700,
      fontSize: 11,
      fontWeight: '900',
    },
    chartValueDetails: {
      gap: 8,
      borderWidth: 1,
      borderColor: isDark ? '#21475A' : '#CDE6EF',
      backgroundColor: isDark ? '#0F2230' : '#F4FBFE',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
    },
    chartValueDetailsCompact: {
      alignSelf: 'center',
      minWidth: 160,
      maxWidth: 260,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    chartValueDetailsSplitCompact: {
      alignSelf: 'center',
      minWidth: 180,
      maxWidth: '92%',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    chartValueDetailsHeader: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    chartValueDetailsHeaderCompact: {
      flex: 1,
      minWidth: 0,
    },
    chartValueDetailsHeaderSplitCompact: {
      paddingHorizontal: 2,
      justifyContent: 'center',
    },
    chartValueDetailsTitle: {
      color: palette.ink900,
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
    },
    chartValueDetailsTotal: {
      alignSelf: 'center',
      minWidth: 120,
      color: palette.ink700,
      fontSize: 11,
      fontWeight: '900',
      textAlign: 'center',
    },
    chartValueDetailsRowSplitCompact: {
      flexDirection: 'column',
      alignItems: 'center',
      flexWrap: 'nowrap',
      justifyContent: 'center',
      gap: 4,
    },
    chartValueDetailsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
    },
    chartValueDetailsRowCompact: {
      flexShrink: 0,
    },
    chartValueDetailsItem: {
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#132A3A' : '#FFFFFF',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
    },
    chartValueDetailsItemCompact: {
      minHeight: 28,
      paddingHorizontal: 7,
      paddingVertical: 5,
    },
    chartValueDetailsItemSplitCompact: {
      alignSelf: 'center',
      minWidth: 150,
      maxWidth: '100%',
      justifyContent: 'center',
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    chartValueDetailsDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
    },
    chartValueDetailsLabel: {
      color: palette.ink700,
      fontSize: 10,
      fontWeight: '800',
    },
    chartValueDetailsValue: {
      minWidth: 0,
      color: palette.ink900,
      fontSize: 11,
      fontWeight: '900',
    },
    chartAxisLabel: {
      color: palette.ink500,
      fontSize: 9,
      fontWeight: '800',
    },
    chartMonthLabel: {
      color: palette.ink700,
      fontSize: 9,
      fontWeight: '800',
    },
    dailyChartDayLabel: {
      color: palette.ink700,
      fontSize: 8,
      fontWeight: '800',
    },
    chartPlainValueWrap: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    chartPlainValueText: {
      color: isDark ? palette.ink900 : palette.navy900,
      fontWeight: '900',
      lineHeight: 12,
      textAlign: 'center',
      textShadowColor: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.9)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    dailyChartPlainValueText: {
      color: isDark ? '#D9F8FF' : '#0A3344',
      lineHeight: 10,
    },
    stackValueWrap: {
      flex: 1,
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    stackValueText: {
      color: '#FFFFFF',
      fontWeight: '900',
      lineHeight: 9,
      textAlign: 'center',
      textShadowColor: 'rgba(0,0,0,0.28)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    productionLegendRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    productionLegendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    productionLegendSwatch: {
      width: 18,
      height: 7,
      borderWidth: 1,
      borderColor: palette.lineStrong,
    },
    productionLegendProduction: {
      backgroundColor: isDark ? '#2CB4DB' : '#1598C6',
    },
    powerLegendChlorination: {
      backgroundColor: isDark ? palette.teal500 : palette.teal600,
    },
    powerLegendDeepwell: {
      backgroundColor: palette.amber500,
    },
    chemicalLegendChlorine: {
      backgroundColor: isDark ? '#34BFA3' : '#0F8F7C',
    },
    chemicalLegendPeroxide: {
      backgroundColor: isDark ? '#F6C85F' : '#E7A321',
    },
    productionLegendText: {
      color: palette.ink700,
      fontSize: 9,
      fontWeight: '800',
    },
  }, responsiveMetrics, {
    exclude: [
      'chartGridCard.width',
      'chartGridCard.flexBasis',
      'skeletonFill.width',
      'skeletonFillLarge.width',
      'skeletonFillMedium.width',
      'skeletonFillShort.width',
      'exportMenuPanel.width',
    ],
  }));
}
