import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import LottieView from 'lottie-react-native';
import Card from '../components/Card';
import MessageBanner from '../components/MessageBanner';
import PrimaryButton from '../components/PrimaryButton';
import ScreenShell from '../components/ScreenShell';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { approveOperatorProfile, assignProfileRole, getOfficeDashboardSnapshot } from '../services/office';
import { getResponsiveMetrics, scaleStyleDefinitions } from '../theme';
import { loadNotificationReadKeys, saveNotificationReadKeys, saveNotificationUnreadCount } from '../utils/notificationState';
import { formatTimestamp } from '../utils/time';

let styles = StyleSheet.create({});

const DAY_MINUTES = 24 * 60;
const HALF_HOUR_MINUTES = 30;

function formatSlotClock(minutes) {
  const normalizedMinutes = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours24 = Math.floor(normalizedMinutes / 60);
  const mins = normalizedMinutes % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;

  return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function createHalfHourWindows() {
  return Array.from({ length: DAY_MINUTES / HALF_HOUR_MINUTES }, (_, index) => {
    const startMinutes = index * HALF_HOUR_MINUTES;

    return {
      key: `slot-${String(startMinutes).padStart(4, '0')}`,
      label: formatSlotClock(startMinutes),
      startMinutes,
      endMinutes: startMinutes + HALF_HOUR_MINUTES - 1,
    };
  });
}

const SLOT_WINDOWS = createHalfHourWindows();
const SHIFT_FILTERS = [
  { key: 'current', label: 'Current shift' },
  { key: 'all', label: 'All elapsed' },
  { key: 'a', label: 'A-Shift' },
  { key: 'b', label: 'B-Shift' },
  { key: 'c', label: 'C-Shift' },
];
const CHLORINATION_READING_FIELDS = [
  { key: 'totalizer', label: 'Totalizer' },
  { key: 'pressure_psi', label: 'Pressure', unit: 'psi' },
  { key: 'rc_ppm', label: 'RC', unit: 'ppm' },
  { key: 'turbidity_ntu', label: 'Turbidity', unit: 'NTU' },
  { key: 'ph', label: 'pH' },
  { key: 'tds_ppm', label: 'TDS', unit: 'ppm' },
  { key: 'tank_level_liters', label: 'Tank level', unit: 'liters' },
  { key: 'flowrate_m3hr', label: 'Flowrate', unit: 'm3/hr' },
  { key: 'chlorine_consumed', label: 'Chlorine used', unit: 'kg' },
  { key: 'peroxide_consumption', label: 'Peroxide used' },
  { key: 'chlorination_power_kwh', label: 'Power used', unit: 'kWh' },
];
const DEEPWELL_READING_FIELDS = [
  { key: 'upstream_pressure_psi', label: 'Upstream pressure', unit: 'psi' },
  { key: 'downstream_pressure_psi', label: 'Downstream pressure', unit: 'psi' },
  { key: 'flowrate_m3hr', label: 'Flowrate', unit: 'm3/hr' },
  { key: 'vfd_frequency_hz', label: 'VFD frequency', unit: 'Hz' },
  { key: 'voltage_l1_v', label: 'Voltage L1', unit: 'V' },
  { key: 'voltage_l2_v', label: 'Voltage L2', unit: 'V' },
  { key: 'voltage_l3_v', label: 'Voltage L3', unit: 'V' },
  { key: 'amperage_a', label: 'Amperage', unit: 'A' },
  { key: 'tds_ppm', label: 'TDS', unit: 'ppm' },
  { key: 'power_kwh_shift', label: 'Shift power', unit: 'kWh' },
];
const OPERATION_THRESHOLDS = {
  CHLORINATION: [
    { field: 'pressure_psi', label: 'Pressure', min: 20, max: 100, unit: 'psi' },
    { field: 'rc_ppm', label: 'Residual chlorine', min: 0.3, max: 1.5, unit: 'ppm' },
    { field: 'turbidity_ntu', label: 'Turbidity', min: 0, max: 5, unit: 'NTU' },
    { field: 'ph', label: 'pH', min: 6.5, max: 7 },
    { field: 'tds_ppm', label: 'TDS', min: 0, max: 300, unit: 'ppm' },
  ],
  DEEPWELL: [
    { field: 'upstream_pressure_psi', label: 'Upstream pressure', min: 35, max: 150, unit: 'psi' },
    { field: 'downstream_pressure_psi', label: 'Downstream pressure', min: 20, max: 100, unit: 'psi' },
    { field: 'voltage_l1_v', label: 'Voltage L1', min: 430, max: 490, unit: 'V' },
    { field: 'voltage_l2_v', label: 'Voltage L2', min: 430, max: 490, unit: 'V' },
    { field: 'voltage_l3_v', label: 'Voltage L3', min: 430, max: 490, unit: 'V' },
    { field: 'amperage_a', label: 'Amperage', min: 24, max: 46, unit: 'A' },
    { field: 'tds_ppm', label: 'TDS', min: 0, max: 300, unit: 'ppm' },
  ],
};

function formatMaybeTimestamp(value) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : formatTimestamp(parsed);
}

function formatRelativeTime(value, now = Date.now()) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  const diffMs = Math.max(0, now - parsed.getTime());
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  return `${Math.floor(days / 365)}y ago`;
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

function formatRecordedValue(value, unit) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return unit ? `${value} ${unit}` : String(value);
}

function getRecordedValueRows(reading) {
  if (!reading) {
    return [];
  }

  const readingType = String(reading.site_type || reading.site?.type || '').toLowerCase();
  const fields = readingType === 'deepwell' ? DEEPWELL_READING_FIELDS : CHLORINATION_READING_FIELDS;
  return fields
    .filter(({ key }) => reading[key] !== null && reading[key] !== undefined && reading[key] !== '')
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: formatRecordedValue(reading[field.key], field.unit),
    }));
}

function createSlotTime(minutes, baseDate = new Date(), dayOffset = 0) {
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayOffset);
  date.setMinutes(minutes);
  return date;
}

function getMinutesSinceMidnight(value) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function findReadingForWindow(readings, site, window) {
  return readings.find((reading) => {
    const siteId = reading.site_id ?? reading.site?.id;
    if (String(siteId) !== String(site.id) || !reading.slot_datetime) {
      return false;
    }

    const slotDate = new Date(reading.slot_datetime);
    return slotDate >= window.windowStart && slotDate <= window.windowEnd;
  });
}

function getCheckpointStatus(window, reading, now) {
  if (reading) {
    const submittedAt = new Date(reading.created_at || reading.reading_datetime || reading.slot_datetime);
    return submittedAt > window.windowEnd ? 'late' : 'complete';
  }

  if (now > window.windowEnd) {
    return 'missing';
  }

  if (now >= window.windowStart && now <= window.windowEnd) {
    return 'due';
  }

  return 'upcoming';
}

function getWindowDayOffset(window, now = new Date()) {
  const currentMinutes = getMinutesSinceMidnight(now);
  const isCShiftSlot = getShiftKeyForMinutes(window.startMinutes) === 'c';
  const isLateNightCShift = currentMinutes >= 23 * 60;
  const isBeforeTonightCShift = currentMinutes < 23 * 60;
  const isEarlyMorningSlot = isCShiftSlot && window.startMinutes < 7 * 60;
  const isPreviousNightSlot = isCShiftSlot && window.startMinutes >= 23 * 60;

  if (isLateNightCShift && isEarlyMorningSlot) {
    return 1;
  }

  return isBeforeTonightCShift && isPreviousNightSlot ? -1 : 0;
}

function buildSlotTimeline({ sites = [], readings = [], typeFilter = 'all', now = new Date() }) {
  const filteredSites = sites.filter((site) => {
    return typeFilter === 'all' || String(site.type || '').toLowerCase() === typeFilter;
  });

  return SLOT_WINDOWS.map((window) => {
    const dayOffset = getWindowDayOffset(window, now);
    const windowWithDates = {
      ...window,
      dayOffset,
      windowStart: createSlotTime(window.startMinutes, now, dayOffset),
      windowEnd: createSlotTime(window.endMinutes, now, dayOffset),
    };
    const checkpoints = filteredSites.map((site) => {
      const reading = findReadingForWindow(readings, site, windowWithDates);
      return {
        id: `${windowWithDates.key}:${site.id}`,
        site,
        reading,
        status: getCheckpointStatus(windowWithDates, reading, now),
      };
    });

    return {
      ...windowWithDates,
      timeLabel: `${formatSlotClock(windowWithDates.startMinutes)}-${formatSlotClock(windowWithDates.endMinutes)}`,
      sortTime: windowWithDates.windowStart.getTime(),
      checkpoints,
    };
  });
}

function summarizeTimeline(timeline) {
  const checkpoints = timeline.flatMap((slot) => slot.checkpoints);

  return checkpoints.reduce(
    (summary, checkpoint) => ({
      ...summary,
      total: summary.total + 1,
      [checkpoint.status]: (summary[checkpoint.status] ?? 0) + 1,
    }),
    {
      total: 0,
      complete: 0,
      due: 0,
      late: 0,
      missing: 0,
      upcoming: 0,
    }
  );
}

function summarizeTimelineSlots(timeline) {
  return timeline.reduce(
    (summary, slot) => {
      const status = getSlotAggregateStatus(slot);

      return {
        ...summary,
        total: summary.total + 1,
        [status]: (summary[status] ?? 0) + 1,
      };
    },
    {
      total: 0,
      complete: 0,
      due: 0,
      late: 0,
      missing: 0,
      upcoming: 0,
    }
  );
}

function getSlotAggregateStatus(slot) {
  const statuses = slot.checkpoints.map((checkpoint) => checkpoint.status);

  if (!statuses.length) {
    return 'upcoming';
  }

  if (statuses.includes('missing')) {
    return 'missing';
  }

  if (statuses.includes('due')) {
    return 'due';
  }

  if (statuses.includes('late')) {
    return 'late';
  }

  if (statuses.every((status) => status === 'complete')) {
    return 'complete';
  }

  return 'upcoming';
}

function getShiftKeyForMinutes(minutes) {
  if (minutes >= 7 * 60 && minutes < 15 * 60) {
    return 'a';
  }

  if (minutes >= 15 * 60 && minutes < 23 * 60) {
    return 'b';
  }

  return 'c';
}

function getCurrentShiftKey(now = new Date()) {
  return getShiftKeyForMinutes(getMinutesSinceMidnight(now));
}

function getShiftLabelForKey(key) {
  return {
    a: 'A-Shift',
    b: 'B-Shift',
    c: 'C-Shift',
  }[key] || 'Current shift';
}

function getCurrentShiftWindow(now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  const hour = now.getHours();

  if (hour >= 7 && hour < 15) {
    start.setHours(7, 0, 0, 0);
    end.setHours(15, 0, 0, 0);
  } else if (hour >= 15 && hour < 23) {
    start.setHours(15, 0, 0, 0);
    end.setHours(23, 0, 0, 0);
  } else if (hour >= 23) {
    start.setHours(23, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    end.setHours(7, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 1);
    start.setHours(23, 0, 0, 0);
    end.setHours(7, 0, 0, 0);
  }

  return { start: start.getTime(), end: end.getTime() };
}

function getReadingTime(reading) {
  const parsed = new Date(reading?.slot_datetime || reading?.reading_datetime || reading?.created_at);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getReadingSiteName(reading) {
  return reading?.site?.name || reading?.sites?.name || (reading?.site_type === 'DEEPWELL' ? 'Deepwell site' : 'Chlorination site');
}

function addOperationRangeAlert(alerts, reading, { field, label, min, max, unit = '' }) {
  const value = Number(reading?.[field]);

  if (!Number.isFinite(value) || (value >= min && value <= max)) {
    return;
  }

  const status = value < min ? 'Low' : 'High';
  const slotText = formatMaybeTimestamp(reading?.slot_datetime || reading?.reading_datetime || reading?.created_at);

  alerts.push({
    key: `${reading.site_type || 'site'}-${reading.id || field}-${field}-${status.toLowerCase()}`,
    severity: value < min ? 'warning' : 'critical',
    title: `${label} ${status}`,
    detail: `${getReadingSiteName(reading)} reported ${value}${unit ? ` ${unit}` : ''} for ${slotText}; normal range is ${min}-${max}${unit ? ` ${unit}` : ''}.`,
    timestamp: reading?.created_at || reading?.reading_datetime || reading?.slot_datetime,
    reading,
    alertField: field,
  });
}

function buildOperationAlerts(dashboard, nowDate = new Date()) {
  const alerts = [];
  const readings = dashboard?.recentReadings ?? [];
  const slotReadings = dashboard?.todaySlotReadings ?? [];
  const now = nowDate.getTime();
  const newestReadingTime = readings.reduce((latest, reading) => Math.max(latest, getReadingTime(reading)), 0);
  const { start, end } = getCurrentShiftWindow(nowDate);
  const currentShiftReadings = readings.filter((reading) => {
    const time = getReadingTime(reading);
    return time >= start && time < end;
  });
  const currentShiftLabel = getShiftLabelForKey(getCurrentShiftKey(nowDate));

  if (newestReadingTime && now - newestReadingTime > 8 * 60 * 60 * 1000) {
    alerts.push({
      key: 'stale-readings',
      severity: 'critical',
      title: 'No recent readings',
      detail: `Latest reading was ${formatMaybeTimestamp(newestReadingTime)}.`,
    });
  }

  ['CHLORINATION', 'DEEPWELL'].forEach((siteType) => {
    if (!currentShiftReadings.some((reading) => reading.site_type === siteType)) {
      alerts.push({
        key: `missing-${siteType}`,
        severity: 'warning',
        title: `${siteType === 'CHLORINATION' ? 'Chlorination' : 'Deepwell'} shift reading missing`,
        detail: `No ${siteType.toLowerCase()} reading has been received for ${currentShiftLabel}.`,
      });
    }
  });

  slotReadings
    .filter((reading) => getReadingTime(reading) <= now)
    .sort((a, b) => getReadingTime(b) - getReadingTime(a))
    .forEach((reading) => {
      (OPERATION_THRESHOLDS[reading.site_type] || []).forEach((threshold) => {
        addOperationRangeAlert(alerts, reading, threshold);
      });
    });

  if (dashboard?.pendingApprovals?.length) {
    alerts.push({
      key: 'pending-approvals',
      severity: 'info',
      title: 'Operator approvals waiting',
      detail: `${dashboard.pendingApprovals.length} operator account(s) need account manager review.`,
    });
  }

  return alerts;
}

function getNotificationTimestamp(item) {
  return new Date(item?.timestamp || item?.created_at || 0).getTime() || 0;
}

function sortNotifications(items) {
  return [...items].sort((a, b) => getNotificationTimestamp(b) - getNotificationTimestamp(a));
}

function createNotification({ key, type = 'activity', tone = 'info', iconName = 'information-circle-outline', title, description, timestamp, badge, ...rest }) {
  return {
    key,
    type,
    tone,
    iconName,
    title,
    description,
    timestamp: timestamp || new Date().toISOString(),
    badge: badge || (tone === 'success' ? 'Success' : tone === 'warning' ? 'Warning' : tone === 'critical' ? 'Critical' : 'Info'),
    ...rest,
  };
}

function buildMonitoringNotifications({ operationAlerts, lastUpdatedAt }) {
  const notifications = [];

  operationAlerts.forEach((alert) => {
    notifications.push(createNotification({
      key: `operation-${alert.key}`,
      type: 'alert',
      tone: alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info',
      iconName: alert.severity === 'critical' ? 'alert-circle-outline' : 'warning-outline',
      title: alert.title,
      description: alert.detail,
      timestamp: alert.timestamp || lastUpdatedAt || new Date().toISOString(),
      badge: alert.severity,
      reading: alert.reading,
      alertField: alert.alertField,
    }));
  });

  if (operationAlerts.some((alert) => alert.key === 'stale-readings')) {
    notifications.push(createNotification({
      key: 'device-disconnected',
      type: 'alert',
      tone: 'critical',
      iconName: 'wifi-outline',
      title: 'Device disconnected',
      description: 'No recent readings have been received from the monitoring network.',
      timestamp: lastUpdatedAt || new Date().toISOString(),
      badge: 'Critical',
    }));
  }

  return sortNotifications(Array.from(new Map(notifications.map((item) => [item.key, item])).values())).slice(0, 40);
}

function filterTimelineByShift(timeline, shiftFilter, now = new Date()) {
  if (shiftFilter === 'all') {
    return timeline;
  }

  const targetShift = shiftFilter === 'current' ? getCurrentShiftKey(now) : shiftFilter;
  return timeline.filter((slot) => getShiftKeyForMinutes(slot.startMinutes) === targetShift);
}

function sortVisibleTimeline(timeline, now = new Date(), shiftFilter = 'current') {
  const shiftSlots = filterTimelineByShift(timeline, shiftFilter, now);
  return shiftSlots
    .filter((slot) => slot.windowStart <= now)
    .sort((a, b) => b.sortTime - a.sortTime);
}

function SectionHeader({ title, body, iconName = 'grid-outline', iconColor }) {
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

function StatTile({ label, value, iconName, accent = 'teal', iconColor }) {
  const accentStyle = {
    teal: styles.statIconTeal,
    navy: styles.statIconNavy,
    amber: styles.statIconAmber,
    rose: styles.statIconRose,
  }[accent] || styles.statIconTeal;

  return (
    <View style={styles.statTile}>
      <View style={styles.statTopRow}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={[styles.statIconWrap, accentStyle]}>
          <Ionicons name={iconName} size={13} color={iconColor} />
        </View>
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function RoleBadge({ role }) {
  const appearance = {
    operator: styles.roleOperator,
    supervisor: styles.roleSupervisor,
    manager: styles.roleManager,
    general_manager: styles.roleGeneralManager,
    admin: styles.roleAdmin,
  }[role] || styles.roleOperator;

  return (
    <View style={[styles.roleBadge, appearance]}>
      <Text style={styles.roleBadgeText}>{formatRoleLabel(role)}</Text>
    </View>
  );
}

function OperationAlertsPanel({ alerts, palette }) {
  const hasAlerts = alerts.length > 0;
  const [expandedAlerts, setExpandedAlerts] = useState({});
  const severityMeta = {
    critical: { iconName: 'alert-circle', style: styles.operationAlertCritical },
    warning: { iconName: 'warning', style: styles.operationAlertWarning },
    info: { iconName: 'information-circle', style: styles.operationAlertInfo },
  };

  return (
    <Card style={[styles.operationAlertsPanel, hasAlerts && styles.operationAlertsPanelActive]}>
      <SectionHeader
        title="Operations alerts"
        body={hasAlerts ? `${alerts.length} item(s) need attention` : 'No active operating alerts from recent readings.'}
        iconName={hasAlerts ? 'warning-outline' : 'shield-checkmark-outline'}
        iconColor={hasAlerts ? palette.amber500 : palette.teal600}
      />

      {hasAlerts ? (
        <ScrollView style={[styles.operationAlertScroll, alerts.length >= 3 && styles.operationAlertScrollPeek]} nestedScrollEnabled>
          <View style={styles.operationAlertStack}>
            {alerts.map((alert) => {
              const meta = severityMeta[alert.severity] || severityMeta.info;
              const isExpanded = Boolean(expandedAlerts[alert.key]);

              return (
                <Pressable
                  key={alert.key}
                  onPress={() => setExpandedAlerts((current) => ({ ...current, [alert.key]: !current[alert.key] }))}
                  style={({ pressed }) => [
                    styles.operationAlertCard,
                    meta.style,
                    pressed && styles.operationAlertCardPressed,
                  ]}
                >
                  <View style={styles.operationAlertCardHead}>
                    <View style={styles.operationAlertTitleRow}>
                      <Ionicons name={meta.iconName} size={14} color="#FFFFFF" />
                      <Text style={styles.operationAlertTitle} numberOfLines={1}>{alert.title}</Text>
                    </View>
                    <View style={styles.operationAlertMetaRow}>
                    <View style={styles.operationAlertSeverityPill}>
                      <Text style={styles.operationAlertSeverityText}>{alert.severity}</Text>
                    </View>
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={palette.ink900} />
                    </View>
                  </View>
                  {isExpanded ? <Text style={styles.operationAlertDetail}>{alert.detail}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <MessageBanner tone="success">No active operating alerts.</MessageBanner>
      )}
    </Card>
  );
}

const NOTIFICATION_FILTERS = [
  { key: 'alerts', label: 'Alerts' },
];
const ACCOUNT_MANAGER_ROLES = ['admin', 'general_manager'];
const OFFICE_MONITOR_ROLES = ['admin', 'supervisor', 'manager', 'general_manager'];

function formatRoleLabel(role) {
  return String(role || 'operator').replace(/_/g, ' ').toUpperCase();
}

function formatRoleChoiceLabel(role) {
  return String(role || 'operator')
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function NotificationCenter({
  notifications,
  unreadCount,
  readMap,
  filter,
  onChangeFilter,
  onMarkAllRead,
  onPressNotification,
  palette,
}) {
  return (
    <View style={styles.notificationCenter}>
      <View style={styles.notificationHero}>
        <View style={styles.notificationHeroIcon}>
          <Ionicons name="notifications-outline" size={18} color={palette.cyan300} />
        </View>
        <View style={styles.notificationHeroCopy}>
          <Text style={styles.notificationHeroTitle}>Realtime alerts</Text>
          <Text style={styles.notificationHeroBody}>Threshold, missing-reading, approval, and monitoring alerts.</Text>
        </View>
        <Pressable onPress={onMarkAllRead} style={({ pressed }) => [styles.markReadButton, pressed && styles.quickActionPressed]}>
          <Text style={styles.markReadText}>Mark all as read</Text>
        </Pressable>
      </View>

      <View style={styles.notificationFilterRow}>
        {NOTIFICATION_FILTERS.map((item) => {
          const active = filter === item.key;

          return (
            <Pressable
              key={item.key}
              onPress={() => onChangeFilter(item.key)}
              style={({ pressed }) => [
                styles.notificationFilterTab,
                active && styles.notificationFilterTabActive,
                pressed && styles.quickActionPressed,
              ]}
            >
              <Text style={[styles.notificationFilterText, active && styles.notificationFilterTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.notificationMetaRow}>
        <Text style={styles.notificationMetaText}>{notifications.length} visible</Text>
        <Text style={styles.notificationMetaText}>{unreadCount} unread</Text>
      </View>

      <View style={styles.notificationStack}>
        {notifications.length ? (
          notifications.map((item) => (
            <NotificationCard
              key={item.key}
              item={item}
              unread={!readMap[item.key]}
              onPress={onPressNotification}
            />
          ))
        ) : (
          <MessageBanner tone="info">No active alerts right now.</MessageBanner>
        )}
      </View>
    </View>
  );
}

function NotificationCard({ item, unread, onPress }) {
  const toneStyle = {
    success: styles.notificationCardSuccess,
    warning: styles.notificationCardWarning,
    critical: styles.notificationCardCritical,
    info: styles.notificationCardInfo,
  }[item.tone] || styles.notificationCardInfo;
  const iconStyle = {
    success: styles.notificationIconSuccess,
    warning: styles.notificationIconWarning,
    critical: styles.notificationIconCritical,
    info: styles.notificationIconInfo,
  }[item.tone] || styles.notificationIconInfo;
  const badgeStyle = {
    success: styles.notificationBadgeSuccess,
    warning: styles.notificationBadgeWarning,
    critical: styles.notificationBadgeCritical,
    info: styles.notificationBadgeInfo,
  }[item.tone] || styles.notificationBadgeInfo;

  const isPressable = Boolean(item.reading && onPress);

  return (
    <Pressable
      disabled={!isPressable}
      onPress={isPressable ? () => onPress(item) : undefined}
      style={({ pressed }) => [
        styles.notificationCard,
        toneStyle,
        pressed && styles.quickActionPressed,
      ]}
    >
      {unread ? <View style={styles.notificationUnreadDot} /> : null}
      <View style={[styles.notificationIcon, iconStyle]}>
        <Ionicons name={item.iconName} size={17} color="#FFFFFF" />
      </View>
      <View style={styles.notificationCardCopy}>
        <View style={styles.notificationCardTopRow}>
          <Text numberOfLines={1} style={styles.notificationTitle}>{item.title}</Text>
          <View style={[styles.notificationBadge, badgeStyle]}>
            <Text style={styles.notificationBadgeText}>{item.badge}</Text>
          </View>
        </View>
        <Text style={styles.notificationDescription}>{item.description}</Text>
        <Text style={styles.notificationTimestamp}>{formatRelativeTime(item.timestamp)}</Text>
      </View>
    </Pressable>
  );
}

function SummaryCard({ title, value, body, actionLabel, onPress, iconName, iconColor, actionIconColor }) {
  return (
    <Card style={styles.summaryCard}>
      <View style={styles.summaryHeaderRow}>
        <View style={styles.summaryHeading}>
          <View style={styles.summaryIconWrap}>
            <Ionicons name={iconName} size={14} color={iconColor} />
          </View>
          <Text style={styles.summaryTitle}>{title}</Text>
        </View>
        <Pressable onPress={onPress} style={({ pressed }) => [styles.summaryActionPill, pressed && styles.quickActionPressed]}>
          <Text style={styles.summaryActionPillText}>{actionLabel}</Text>
          <Ionicons name="arrow-forward" size={11} color={actionIconColor} />
        </Pressable>
      </View>
      <View style={styles.summaryMetricRow}>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      <Text style={styles.summaryBody} numberOfLines={2}>
        {body}
      </Text>
    </Card>
  );
}

function EntityCard({ children, style, accentStyle }) {
  return (
    <View style={[styles.entityCard, style]}>
      <View style={[styles.entityAccent, accentStyle]} />
      {children}
    </View>
  );
}

function DashboardSkeletonBlock({ pulseOpacity, style }) {
  return <Animated.View style={[styles.dashboardSkeletonBlock, style, { opacity: pulseOpacity }]} />;
}

function DashboardSkeletonCard({ children, style }) {
  return (
    <Card style={[styles.panelCard, styles.dashboardSkeletonCard, style]}>
      {children}
    </Card>
  );
}

function DashboardSkeleton({ isAdmin, isWide }) {
  const pulseOpacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 1,
          duration: 760,
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.55,
          duration: 760,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [pulseOpacity]);

  const skeleton = (style) => <DashboardSkeletonBlock pulseOpacity={pulseOpacity} style={style} />;

  return (
    <View style={styles.sectionStack}>
      {isAdmin ? (
        <DashboardSkeletonCard>
          <View style={styles.dashboardSkeletonHeaderRow}>
            {skeleton(styles.dashboardSkeletonTitle)}
            {skeleton(styles.dashboardSkeletonMeta)}
          </View>
          <View style={styles.dashboardSkeletonChipRow}>
            {[0, 1, 2, 3].map((item) => (
              <DashboardSkeletonBlock
                key={`chip-${item}`}
                pulseOpacity={pulseOpacity}
                style={[styles.dashboardSkeletonChip, item === 0 && styles.dashboardSkeletonChipWide]}
              />
            ))}
          </View>
        </DashboardSkeletonCard>
      ) : null}

      <DashboardSkeletonCard>
        <View style={styles.dashboardSkeletonSectionHeader}>
          {skeleton(styles.dashboardSkeletonIcon)}
          <View style={styles.dashboardSkeletonHeaderCopy}>
            {skeleton(styles.dashboardSkeletonHeading)}
            {skeleton(styles.dashboardSkeletonSubheading)}
          </View>
        </View>
        <View style={styles.statsGrid}>
          {[0, 1, 2, 3, 4].map((item) => (
            <View key={`stat-${item}`} style={styles.dashboardSkeletonStatTile}>
              <View style={styles.dashboardSkeletonHeaderRow}>
                {skeleton(styles.dashboardSkeletonTinyLine)}
                {skeleton(styles.dashboardSkeletonSmallIcon)}
              </View>
              {skeleton(styles.dashboardSkeletonValue)}
            </View>
          ))}
        </View>
      </DashboardSkeletonCard>

      <View style={[styles.summaryGrid, isWide && styles.summaryGridWide]}>
        {[0, 1, 2].map((item) => (
          <DashboardSkeletonCard key={`summary-${item}`} style={styles.summaryCard}>
            <View style={styles.dashboardSkeletonHeaderRow}>
              <View style={styles.dashboardSkeletonSummaryHeading}>
                {skeleton(styles.dashboardSkeletonIcon)}
                {skeleton(styles.dashboardSkeletonSummaryTitle)}
              </View>
              {skeleton(styles.dashboardSkeletonAction)}
            </View>
            {skeleton(styles.dashboardSkeletonSummaryValue)}
            {skeleton(styles.dashboardSkeletonSummaryBody)}
            {skeleton(styles.dashboardSkeletonSummaryBodyShort)}
          </DashboardSkeletonCard>
        ))}
      </View>

      <DashboardSkeletonCard>
        <View style={styles.dashboardSkeletonSectionHeader}>
          {skeleton(styles.dashboardSkeletonIcon)}
          <View style={styles.dashboardSkeletonHeaderCopy}>
            {skeleton(styles.dashboardSkeletonHeading)}
            {skeleton(styles.dashboardSkeletonSubheading)}
          </View>
        </View>
        <View style={styles.list}>
          {[0, 1, 2].map((item) => (
            <View key={`row-${item}`} style={styles.dashboardSkeletonEntity}>
              <View style={styles.dashboardSkeletonHeaderRow}>
                <View style={styles.dashboardSkeletonHeaderCopy}>
                  {skeleton(styles.dashboardSkeletonRowTitle)}
                  {skeleton(styles.dashboardSkeletonRowMeta)}
                </View>
                {skeleton(styles.dashboardSkeletonBadge)}
              </View>
              <View style={styles.metaStrip}>
                {skeleton(styles.dashboardSkeletonMetaPill)}
                {skeleton(styles.dashboardSkeletonMetaPill)}
              </View>
            </View>
          ))}
        </View>
      </DashboardSkeletonCard>
    </View>
  );
}

export default function OfficeDashboardScreen({ navigation, initialSection }) {
  const { profile } = useAuth();
  const { palette, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const responsiveMetrics = useMemo(() => getResponsiveMetrics(width), [width]);
  styles = useMemo(() => createStyles(palette, isDark, responsiveMetrics), [palette, isDark, responsiveMetrics]);
  const isWide = width >= 980;
  const isAdmin = profile?.role === 'admin';
  const canManageAccounts = ACCOUNT_MANAGER_ROLES.includes(profile?.role);
  const requestedSection = initialSection || (profile?.role === 'general_manager' ? 'readings' : canManageAccounts ? 'overview' : 'readings');
  const roleChoices = ['operator', 'supervisor', 'manager', 'general_manager', 'admin'];
  const [activeSection, setActiveSection] = useState(requestedSection);
  const [dashboard, setDashboard] = useState({
    stats: {
      totalOperators: 0,
      approvedOperators: 0,
      pendingOperators: 0,
      totalSites: 0,
      todayReadings: 0,
    },
    pendingApprovals: [],
    recentReadings: [],
    sites: [],
    todaySlotReadings: [],
    profiles: [],
    monthlyProduction: {
      totalProduction: 0,
      averageProduction: 0,
      rows: [],
    },
    dailyProduction: {
      monthLabel: '',
      totalProduction: 0,
      rows: [],
    },
    monthlyPowerConsumption: {
      totalPower: 0,
      rows: [],
    },
  });
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState('');
  const [roleUpdatingId, setRoleUpdatingId] = useState('');
  const [openRoleMenuId, setOpenRoleMenuId] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [recentReadingFilter, setRecentReadingFilter] = useState('all');
  const [recentReadingDateFilter, setRecentReadingDateFilter] = useState('all');
  const [visibleRecentReadings, setVisibleRecentReadings] = useState(3);
  const [pendingNoticeDismissed, setPendingNoticeDismissed] = useState(false);
  const [showApprovalAnimation, setShowApprovalAnimation] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState('info');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [shiftFilter, setShiftFilter] = useState('current');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);
  const [notificationFilter, setNotificationFilter] = useState('alerts');
  const [readNotificationKeys, setReadNotificationKeys] = useState({});
  const [liveNotifications, setLiveNotifications] = useState([]);

  useEffect(() => {
    setActiveSection(requestedSection);
  }, [requestedSection]);

  useEffect(() => {
    let mounted = true;

    async function restoreReadNotifications() {
      const storedReadKeys = await loadNotificationReadKeys(profile);
      if (mounted) {
        setReadNotificationKeys(storedReadKeys);
      }
    }

    restoreReadNotifications();

    return () => {
      mounted = false;
    };
  }, [profile?.id, profile?.email]);

  useEffect(() => {
    if (!canManageAccounts && activeSection !== 'readings' && activeSection !== 'notifications') {
      setActiveSection('readings');
    }
  }, [activeSection, canManageAccounts]);

  function pushLiveNotification(notification) {
    if (notification?.type !== 'alert') {
      return;
    }

    setLiveNotifications((current) => sortNotifications([
      createNotification(notification),
      ...current,
    ]).slice(0, 30));
  }

  async function loadDashboard({ silent = false, successMessage = '' } = {}) {
    if (!silent) {
      setLoading(true);
    }

    try {
      const nextDashboard = await getOfficeDashboardSnapshot();
      setDashboard(nextDashboard);
      setLastUpdatedAt(new Date());

      if (successMessage) {
        setTone('success');
        setMessage(successMessage);
        pushLiveNotification({
          key: `activity-${Date.now()}`,
          type: 'activity',
          tone: 'success',
          iconName: 'checkmark-circle-outline',
          title: 'Activity successful',
          description: successMessage,
          badge: 'Success',
        });
      } else if (nextDashboard.pendingApprovals.length) {
        setTone('info');
        setMessage('Office dashboard is synced with the live database.');
      } else {
        setMessage('');
      }
      pushLiveNotification({
        key: `sync-success-live-${Date.now()}`,
        type: 'sync',
        tone: 'info',
        iconName: 'sync-circle-outline',
        title: 'Sync successful',
        description: 'Dashboard snapshot refreshed from Supabase.',
        badge: 'Sync',
      });
    } catch (error) {
      setTone('error');
      setMessage(error.message || 'Failed to load office dashboard.');
      pushLiveNotification({
        key: `sync-failed-live-${Date.now()}`,
        type: 'sync',
        tone: 'critical',
        iconName: 'cloud-offline-outline',
        title: 'Sync failed',
        description: error.message || 'Failed to load office dashboard.',
        badge: 'Critical',
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function handleApprove(operatorProfile) {
    setApprovingId(operatorProfile.id);
    setTone('info');
    setMessage(`Approving ${operatorProfile.full_name || operatorProfile.email || 'operator'}...`);

    try {
      await approveOperatorProfile({ profileId: operatorProfile.id });
      await loadDashboard({
        silent: true,
        successMessage: `${operatorProfile.full_name || operatorProfile.email || 'Operator'} is now approved for app access.`,
      });
      setShowApprovalAnimation(true);
    } catch (error) {
      setTone('error');
      setMessage(error.message || 'Approval failed.');
    } finally {
      setApprovingId('');
    }
  }

  async function handleRoleChange(targetProfile, nextRole) {
    setRoleUpdatingId(`${targetProfile.id}:${nextRole}`);
    setOpenRoleMenuId('');
    setTone('info');
    setMessage(`Updating ${targetProfile.full_name || targetProfile.email || 'account'} to ${nextRole}...`);

    try {
      await assignProfileRole({
        profileId: targetProfile.id,
        nextRole,
      });

      await loadDashboard({
        silent: true,
        successMessage: `${targetProfile.full_name || targetProfile.email || 'Account'} is now ${nextRole}.`,
      });
    } catch (error) {
      setTone('error');
      setMessage(error.message || 'Role update failed.');
    } finally {
      setRoleUpdatingId('');
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (!supabase || !OFFICE_MONITOR_ROLES.includes(profile?.role)) {
      return undefined;
    }

    const refreshSlotTimeline = (payload) => {
      const tableLabel = payload?.table === 'deepwell_readings' ? 'deepwell' : 'chlorination';
      const row = payload?.new || payload?.old || {};
      pushLiveNotification({
        key: `realtime-${payload?.table || 'reading'}-${row.id || Date.now()}-${Date.now()}`,
        type: 'activity',
        tone: 'success',
        iconName: payload?.eventType === 'DELETE' ? 'trash-outline' : 'cloud-upload-outline',
        title: payload?.eventType === 'DELETE' ? 'Reading removed' : 'Reading uploaded',
        description: `Realtime ${tableLabel} reading activity synced from Supabase.`,
        timestamp: row.created_at || new Date().toISOString(),
        badge: 'Realtime',
      });
      loadDashboard({ silent: true });
    };

    const channel = supabase
      .channel('office-slot-checkpoints')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chlorination_readings' }, refreshSlotTimeline)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deepwell_readings' }, refreshSlotTimeline)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.role]);

  useEffect(() => {
    if (!dashboard.pendingApprovals.length) {
      setPendingNoticeDismissed(false);
    }
  }, [dashboard.pendingApprovals.length]);

  const roleFilterOptions = useMemo(
    () => [
      { key: 'all', label: 'All', iconName: 'apps-outline' },
      { key: 'operator', label: 'Operators', iconName: 'construct-outline' },
      { key: 'supervisor', label: 'Supervisors', iconName: 'shield-checkmark-outline' },
      { key: 'manager', label: 'Managers', iconName: 'briefcase-outline' },
      { key: 'general_manager', label: 'General Managers', iconName: 'business-outline' },
      { key: 'admin', label: 'Admins', iconName: 'key-outline' },
    ],
    []
  );

  const filteredProfiles = useMemo(() => {
    if (roleFilter === 'all') {
      return dashboard.profiles;
    }

    return dashboard.profiles.filter((item) => item.role === roleFilter);
  }, [dashboard.profiles, roleFilter]);

  const recentReadingFilterOptions = useMemo(
    () => [
      { key: 'all', label: 'All', iconName: 'apps-outline' },
      { key: 'chlorination', label: 'Chlorination', iconName: 'water-outline' },
      { key: 'deepwell', label: 'Deepwell', iconName: 'flash-outline' },
    ],
    []
  );

  const recentReadingDateFilterOptions = useMemo(
    () => [
      { key: 'all', label: 'All time', iconName: 'time-outline' },
      { key: 'today', label: 'Today', iconName: 'today-outline' },
      { key: '24h', label: 'Last 24h', iconName: 'hourglass-outline' },
      { key: '7d', label: 'Last 7 days', iconName: 'calendar-outline' },
    ],
    []
  );

  function getRecentReadingTimestamp(item) {
    const rawValue = item?.slot_datetime || item?.created_at || item?.reading_datetime;
    const parsed = new Date(rawValue || '');
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const filteredRecentReadings = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const last24Hours = now.getTime() - (24 * 60 * 60 * 1000);
    const last7Days = now.getTime() - (7 * 24 * 60 * 60 * 1000);

    return dashboard.recentReadings
      .filter((item) => {
        if (recentReadingFilter !== 'all' && String(item.site?.type || '').toLowerCase() !== recentReadingFilter) {
          return false;
        }

        const timestamp = getRecentReadingTimestamp(item);

        if (recentReadingDateFilter === 'today') {
          return timestamp >= startOfToday;
        }

        if (recentReadingDateFilter === '24h') {
          return timestamp >= last24Hours;
        }

        if (recentReadingDateFilter === '7d') {
          return timestamp >= last7Days;
        }

        return true;
      })
      .sort((a, b) => getRecentReadingTimestamp(b) - getRecentReadingTimestamp(a));
  }, [dashboard.recentReadings, recentReadingDateFilter, recentReadingFilter]);

  const visibleRecentReadingsList = useMemo(
    () => filteredRecentReadings.slice(0, visibleRecentReadings),
    [filteredRecentReadings, visibleRecentReadings]
  );

  useEffect(() => {
    setVisibleRecentReadings(3);
  }, [recentReadingDateFilter, recentReadingFilter, dashboard.recentReadings]);

  useEffect(() => {
    const intervalId = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(intervalId);
  }, []);

  const slotTimeline = useMemo(
    () =>
      sortVisibleTimeline(
        buildSlotTimeline({
          sites: dashboard.sites,
          readings: dashboard.todaySlotReadings,
          typeFilter: recentReadingFilter,
          now: currentTime,
        }),
        currentTime,
        shiftFilter
      ),
    [currentTime, dashboard.sites, dashboard.todaySlotReadings, recentReadingFilter, shiftFilter]
  );

  const expectedSlotTimeline = useMemo(
    () =>
      filterTimelineByShift(
        buildSlotTimeline({
          sites: dashboard.sites,
          readings: dashboard.todaySlotReadings,
          typeFilter: recentReadingFilter,
          now: currentTime,
        }),
        shiftFilter,
        currentTime
      ),
    [currentTime, dashboard.sites, dashboard.todaySlotReadings, recentReadingFilter, shiftFilter]
  );

  const slotSummary = useMemo(() => summarizeTimelineSlots(slotTimeline), [slotTimeline]);
  const expectedSlotSummary = useMemo(() => summarizeTimelineSlots(expectedSlotTimeline), [expectedSlotTimeline]);
  const upcomingSlotCount = Math.max(expectedSlotSummary.upcoming - slotSummary.upcoming, 0);
  const operationAlerts = useMemo(() => buildOperationAlerts(dashboard, currentTime), [dashboard, currentTime]);
  const notificationItems = useMemo(
    () => sortNotifications([
      ...liveNotifications,
      ...buildMonitoringNotifications({
        operationAlerts,
        lastUpdatedAt,
      }),
    ]).filter((item, index, all) => all.findIndex((candidate) => candidate.key === item.key) === index),
    [lastUpdatedAt, liveNotifications, operationAlerts]
  );
  const filteredNotifications = useMemo(
    () =>
      notificationItems.filter((item) => {
        if (notificationFilter === 'alerts') {
          return item.type === 'alert';
        }
        return false;
      }),
    [notificationFilter, notificationItems]
  );
  const unreadNotificationCount = filteredNotifications.filter((item) => !readNotificationKeys[item.key]).length;
  const totalUnreadNotificationCount = notificationItems.filter((item) => !readNotificationKeys[item.key]).length;

  useEffect(() => {
    saveNotificationUnreadCount(profile, totalUnreadNotificationCount);
  }, [profile?.id, profile?.email, totalUnreadNotificationCount]);

  const canViewGraphs = ['manager', 'supervisor', 'general_manager'].includes(profile?.role);
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
      label: `${operationAlerts.length} alerts`,
      tone: operationAlerts.length ? 'warning' : 'neutral',
      iconName: operationAlerts.length ? 'warning-outline' : 'notifications-outline',
      iconColor: operationAlerts.length ? palette.amber500 : palette.ink500,
    },
    {
      key: 'updated',
      label: `Updated ${formatHeaderUpdatedTime(lastUpdatedAt)}`,
      tone: 'neutral',
      iconName: 'ellipse',
      iconColor: palette.teal500,
    },
  ];
  function renderOverview() {
    if (!canManageAccounts) {
      return renderSlotTimeline();
    }

    return (
      <View style={styles.sectionStack}>
        {dashboard.pendingApprovals.length && !pendingNoticeDismissed ? (
          <View style={styles.noticeCard}>
            <View style={styles.noticeTopRow}>
              <View style={styles.noticeCopy}>
                <View style={styles.noticeTitleRow}>
                  <Ionicons name="notifications" size={16} color={palette.amber500} />
                  <Text style={styles.noticeTitle}>Pending approvals</Text>
                  <View style={styles.noticeCountPill}>
                    <Text style={styles.noticeCountText}>{dashboard.pendingApprovals.length}</Text>
                  </View>
                </View>
                <Text style={styles.noticeBody}>
                  {dashboard.pendingApprovals.length} operator account(s) need your review.
                </Text>
              </View>
              <Pressable onPress={() => setPendingNoticeDismissed(true)} style={({ pressed }) => [styles.noticeDismiss, pressed && styles.quickActionPressed]}>
                <Ionicons name="close" size={14} color={palette.ink700} />
              </Pressable>
            </View>
            <View style={styles.noticeActions}>
              <Pressable onPress={() => setActiveSection('approvals')} style={({ pressed }) => [styles.noticeAction, pressed && styles.quickActionPressed]}>
                <Text style={styles.noticeActionText}>Open approvals</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Card style={styles.panelCard}>
          <SectionHeader
            title="Live summary"
            body="Registrations, approvals, sites, and reading activity."
            iconName="pulse-outline"
            iconColor={palette.teal600}
          />
          <View style={styles.statsGrid}>
            <StatTile label="Operators" value={dashboard.stats.totalOperators} iconName="people-outline" accent="navy" iconColor={palette.ink900} />
            <StatTile label="Approved" value={dashboard.stats.approvedOperators} iconName="checkmark-done-outline" accent="teal" iconColor={palette.ink900} />
            <StatTile label="Pending" value={dashboard.stats.pendingOperators} iconName="time-outline" accent="amber" iconColor={palette.ink900} />
            <StatTile label="Sites" value={dashboard.stats.totalSites} iconName="business-outline" accent="navy" iconColor={palette.ink900} />
            <StatTile label="Readings today" value={dashboard.stats.todayReadings} iconName="analytics-outline" accent="rose" iconColor={palette.ink900} />
          </View>
        </Card>

        <View style={[styles.summaryGrid, isWide && styles.summaryGridWide]}>
          <SummaryCard
            title="Pending approvals"
            value={dashboard.pendingApprovals.length}
            body="Review newly registered operators and approve them."
            actionLabel="Open"
            onPress={() => setActiveSection('approvals')}
            iconName="notifications-outline"
            iconColor={palette.ink900}
            actionIconColor={isDark ? palette.ink900 : palette.navy700}
          />
          <SummaryCard
            title="Slot checkpoints"
            value={`${slotSummary.complete}/${slotSummary.total}`}
            body="Confirm today's 30-minute site readings by time slot."
            actionLabel="Open"
            onPress={() => setActiveSection('readings')}
            iconName="checkmark-done-outline"
            iconColor={palette.ink900}
            actionIconColor={isDark ? palette.ink900 : palette.navy700}
          />
          {canManageAccounts ? (
            <SummaryCard
              title="Role management"
              value={dashboard.profiles.length}
              body="Promote trusted office accounts to supervisor, manager, general manager, or admin."
              actionLabel="Open"
              onPress={() => setActiveSection('roles')}
              iconName="people-circle-outline"
              iconColor={palette.ink900}
              actionIconColor={isDark ? palette.ink900 : palette.navy700}
            />
          ) : null}
        </View>

      </View>
    );
  }

  function renderApprovals() {
    if (!canManageAccounts) {
      return renderSlotTimeline();
    }

    return (
      <Card style={styles.panelCard}>
        <SectionHeader
          title="Pending registrations"
          body="Admins and general managers can approve operators here. Approved accounts can enter the data collection flow immediately."
          iconName="person-add-outline"
          iconColor={palette.teal600}
        />

        {dashboard.pendingApprovals.length ? (
          <View style={styles.list}>
            {dashboard.pendingApprovals.map((item) => (
              <EntityCard key={item.id}>
                <View style={styles.entityHeader}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{item.full_name || item.email || 'Unnamed operator'}</Text>
                    <Text style={styles.rowMeta}>{item.email || '-'}</Text>
                  </View>
                  <RoleBadge role={item.role} />
                </View>

                <View style={styles.metaStrip}>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillLabel}>Registered</Text>
                    <Text style={styles.metaPillValue}>{formatMaybeTimestamp(item.created_at)}</Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillLabel}>Approval</Text>
                    <Text style={styles.metaPillValue}>{item.is_approved ? 'Approved' : 'Waiting'}</Text>
                  </View>
                </View>

                <PrimaryButton
                  label={approvingId === item.id ? 'Approving...' : 'Approve operator'}
                  onPress={() => handleApprove(item)}
                  loading={approvingId === item.id}
                  icon={<Ionicons name="checkmark-circle-outline" size={16} color={palette.onAccent} />}
                />
              </EntityCard>
            ))}
          </View>
        ) : (
          <MessageBanner tone="success">No pending registrations are waiting for office approval.</MessageBanner>
        )}
      </Card>
    );
  }

  function renderSlotTimeline() {
    const statusMeta = {
      complete: { label: 'Done', iconName: 'checkmark-circle', style: styles.timelineStatusComplete },
      due: { label: 'Due now', iconName: 'radio-button-on', style: styles.timelineStatusDue },
      late: { label: 'Late', iconName: 'time', style: styles.timelineStatusLate },
      missing: { label: 'Missing', iconName: 'alert-circle', style: styles.timelineStatusMissing },
      upcoming: { label: 'Upcoming', iconName: 'ellipse-outline', style: styles.timelineStatusUpcoming },
    };

    return (
      <View style={styles.sectionStack}>
        <Card style={styles.panelCard}>
          <SectionHeader
            title="30-minute checkpoints"
            body="Current slot appears first. Future slots are counted in Upcoming, not shown below."
            iconName="checkmark-done-outline"
            iconColor={palette.teal600}
          />

          <View style={styles.recentReadingControlGroup}>
            <Text style={styles.recentReadingGroupLabel}>Site type</Text>
            <View style={styles.recentReadingFilterRow}>
              {recentReadingFilterOptions.map((option) => {
                const active = option.key === recentReadingFilter;

                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setRecentReadingFilter(option.key)}
                    style={[styles.recentReadingFilterChip, active && styles.recentReadingFilterChipActive]}
                  >
                    <Ionicons
                      name={option.iconName}
                      size={12}
                      color={active ? palette.onAccent : palette.ink700}
                    />
                    <Text style={[styles.recentReadingFilterChipText, active && styles.recentReadingFilterChipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.recentReadingDateGroup}>
            <Text style={styles.recentReadingGroupLabel}>Shift</Text>
            <View style={styles.recentReadingDateFilterRow}>
              {SHIFT_FILTERS.map((option) => {
                const active = option.key === shiftFilter;

                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setShiftFilter(option.key)}
                    style={[styles.recentReadingDateChip, active && styles.recentReadingDateChipActive]}
                  >
                    <Text style={[styles.recentReadingDateChipText, active && styles.recentReadingDateChipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.timelineSummaryGrid}>
            <View style={styles.timelineSummaryTile}>
              <Text style={styles.timelineSummaryValue}>{slotSummary.complete}</Text>
              <Text style={styles.timelineSummaryLabel}>Complete</Text>
            </View>
            <View style={styles.timelineSummaryTile}>
              <Text style={styles.timelineSummaryValue}>{slotSummary.missing}</Text>
              <Text style={styles.timelineSummaryLabel}>Missing</Text>
            </View>
            <View style={styles.timelineSummaryTile}>
              <Text style={styles.timelineSummaryValue}>{upcomingSlotCount}</Text>
              <Text style={styles.timelineSummaryLabel}>Upcoming</Text>
            </View>
          </View>

          {slotSummary.total ? (
            <View style={styles.timelineStack}>
              {slotTimeline.map((slot, index) => {
                const aggregateStatus = getSlotAggregateStatus(slot);
                const aggregateMeta = statusMeta[aggregateStatus] || statusMeta.upcoming;

                return (
                  <View key={slot.key} style={styles.timelineSlot}>
                    <View style={styles.timelineMarkerColumn}>
                      <View style={[styles.timelineNode, aggregateMeta.style]}>
                        <Ionicons name={aggregateMeta.iconName} size={14} color={palette.onAccent} />
                      </View>
                      {index < slotTimeline.length - 1 ? <View style={styles.timelineLine} /> : null}
                    </View>

                    <View style={styles.timelineSlotBody}>
                      <View style={styles.timelineSlotHeader}>
                        <View>
                          <Text style={styles.timelineSlotTitle}>{slot.label}</Text>
                          <Text style={styles.timelineSlotTime}>{slot.timeLabel}</Text>
                        </View>
                        <View style={[styles.timelineStatusPill, aggregateMeta.style]}>
                          <Text style={styles.timelineStatusPillText}>{aggregateMeta.label}</Text>
                        </View>
                      </View>

                      <View style={styles.timelineCheckpointGrid}>
                        {slot.checkpoints.map((checkpoint) => {
                          const checkpointMeta = statusMeta[checkpoint.status] || statusMeta.upcoming;
                          const canOpenReading = Boolean(checkpoint.reading);
                          const submitter =
                            checkpoint.reading?.submitted_profile?.full_name ||
                            checkpoint.reading?.submitted_profile?.email ||
                            '';

                          return (
                            <Pressable
                              key={checkpoint.id}
                              disabled={!canOpenReading}
                              onPress={() => setSelectedCheckpoint({ ...checkpoint, slot })}
                              style={({ pressed }) => [
                                styles.timelineCheckpoint,
                                canOpenReading && styles.timelineCheckpointPressable,
                                pressed && canOpenReading ? styles.timelineCheckpointPressed : null,
                              ]}
                            >
                              <View style={[styles.timelineCheckpointIcon, checkpointMeta.style]}>
                                <Ionicons name={checkpointMeta.iconName} size={12} color={palette.onAccent} />
                              </View>
                              <View style={styles.timelineCheckpointCopy}>
                                <Text style={styles.timelineCheckpointSite} numberOfLines={1}>
                                  {checkpoint.site.name}
                                </Text>
                                <Text style={styles.timelineCheckpointMeta} numberOfLines={2}>
                                  {checkpoint.reading
                                    ? `${checkpointMeta.label} by ${submitter || '-'}`
                                    : checkpointMeta.label}
                                </Text>
                              </View>
                              {canOpenReading ? (
                                <Ionicons name="eye-outline" size={14} color={palette.ink500} />
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <MessageBanner tone="info">No active sites match this checkpoint filter right now.</MessageBanner>
          )}
        </Card>
      </View>
    );
  }

  function renderNotifications() {
    return (
      <View style={styles.sectionStack}>
        <NotificationCenter
          notifications={filteredNotifications}
          unreadCount={unreadNotificationCount}
          readMap={readNotificationKeys}
          filter={notificationFilter}
          onChangeFilter={setNotificationFilter}
          onMarkAllRead={() => {
            const nextReadKeys = Object.fromEntries(notificationItems.map((item) => [item.key, true]));
            setReadNotificationKeys(nextReadKeys);
            saveNotificationReadKeys(profile, nextReadKeys);
            saveNotificationUnreadCount(profile, 0);
          }}
          onPressNotification={(item) => {
            if (!item?.reading) {
              return;
            }

            const nextReadKeys = {
              ...readNotificationKeys,
              [item.key]: true,
            };
            setReadNotificationKeys(nextReadKeys);
            saveNotificationReadKeys(profile, nextReadKeys);
            setSelectedCheckpoint({
              id: item.key,
              site: item.reading.site || item.reading.sites,
              reading: item.reading,
              alertField: item.alertField,
              slot: {
                timeLabel: formatMaybeTimestamp(item.reading.slot_datetime || item.reading.reading_datetime),
              },
            });
          }}
          palette={palette}
        />
      </View>
    );
  }

  function renderRecordedValuesModal() {
    const reading = selectedCheckpoint?.reading;
    const valueRows = getRecordedValueRows(reading);
    const highlightedField = selectedCheckpoint?.alertField;
    const submitter =
      reading?.submitted_profile?.full_name ||
      reading?.submitted_profile?.email ||
      '-';

    return (
      <Modal
        visible={Boolean(reading)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSelectedCheckpoint(null)}
      >
        <View style={styles.recordedValuesOverlay}>
          <Pressable style={styles.recordedValuesBackdrop} onPress={() => setSelectedCheckpoint(null)} />
          <View style={styles.recordedValuesSheet}>
            <View style={styles.recordedValuesHeader}>
              <View style={styles.recordedValuesTitleWrap}>
                <Text style={styles.recordedValuesEyebrow}>{reading?.site_type || reading?.site?.type || 'Reading'}</Text>
                <Text style={styles.recordedValuesTitle} numberOfLines={2}>
                  {selectedCheckpoint?.site?.name || reading?.site?.name || 'Recorded values'}
                </Text>
                <Text style={styles.recordedValuesMeta}>
                  {selectedCheckpoint?.slot?.timeLabel || formatMaybeTimestamp(reading?.slot_datetime)}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedCheckpoint(null)} style={styles.recordedValuesClose}>
                <Ionicons name="close" size={18} color={palette.ink700} />
              </Pressable>
            </View>

            <View style={styles.recordedValuesMetaGrid}>
              <View style={styles.recordedValuesMetaTile}>
                <Text style={styles.recordedValuesMetaLabel}>Submitted by</Text>
                <Text style={styles.recordedValuesMetaValue} numberOfLines={2}>{submitter}</Text>
              </View>
              <View style={styles.recordedValuesMetaTile}>
                <Text style={styles.recordedValuesMetaLabel}>Saved</Text>
                <Text style={styles.recordedValuesMetaValue}>{formatMaybeTimestamp(reading?.created_at)}</Text>
              </View>
            </View>

            <ScrollView style={styles.recordedValuesScroll} contentContainerStyle={styles.recordedValuesList}>
              {valueRows.length ? (
                valueRows.map((row) => {
                  const isHighlighted = highlightedField && row.key === highlightedField;

                  return (
                    <View key={row.label} style={[styles.recordedValueRow, isHighlighted && styles.recordedValueRowAlert]}>
                      <Text style={[styles.recordedValueLabel, isHighlighted && styles.recordedValueLabelAlert]}>{row.label}</Text>
                      <Text style={[styles.recordedValueValue, isHighlighted && styles.recordedValueValueAlert]}>{row.value}</Text>
                    </View>
                  );
                })
              ) : (
                <MessageBanner tone="info">No numeric values were saved for this reading.</MessageBanner>
              )}

              {reading?.remarks ? (
                <View style={styles.recordedRemarks}>
                  <Text style={styles.recordedValueLabel}>Remarks</Text>
                  <Text style={styles.recordedRemarksText}>{reading.remarks}</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  function renderReadings() {
    function getReadingCardAppearance(siteType) {
      const normalizedType = String(siteType || '').toLowerCase();

      if (normalizedType === 'chlorination') {
        return {
          cardStyle: styles.readingCardChlorination,
          accentStyle: styles.entityAccentChlorination,
        };
      }

      if (normalizedType === 'deepwell') {
        return {
          cardStyle: styles.readingCardDeepwell,
          accentStyle: styles.entityAccentDeepwell,
        };
      }

      return {
        cardStyle: null,
        accentStyle: null,
      };
    }

    return (
      <View style={styles.sectionStack}>
        <Card style={styles.panelCard}>
          <SectionHeader
            title="Recent readings"
            body={canManageAccounts ? 'Latest submissions from the shared database.' : 'This account has readings-only office access.'}
            iconName="reader-outline"
            iconColor={palette.teal600}
          />

          <View style={styles.recentReadingControlGroup}>
            <Text style={styles.recentReadingGroupLabel}>Sort by type</Text>
            <View style={styles.recentReadingFilterRow}>
              {recentReadingFilterOptions.map((option) => {
                const active = option.key === recentReadingFilter;

                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setRecentReadingFilter(option.key)}
                    style={[styles.recentReadingFilterChip, active && styles.recentReadingFilterChipActive]}
                  >
                    <Ionicons
                      name={option.iconName}
                      size={12}
                      color={active ? palette.onAccent : palette.ink700}
                    />
                    <Text style={[styles.recentReadingFilterChipText, active && styles.recentReadingFilterChipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.recentReadingDateGroup}>
            <Text style={styles.recentReadingGroupLabel}>Date range</Text>
            <View style={styles.recentReadingDateFilterRow}>
              {recentReadingDateFilterOptions.map((option) => {
                const active = option.key === recentReadingDateFilter;

                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setRecentReadingDateFilter(option.key)}
                    style={[styles.recentReadingDateChip, active && styles.recentReadingDateChipActive]}
                  >
                    <Ionicons
                      name={option.iconName}
                      size={12}
                      color={active ? palette.onAccent : palette.ink700}
                    />
                    <Text style={[styles.recentReadingDateChipText, active && styles.recentReadingDateChipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {filteredRecentReadings.length ? (
            <View style={styles.list}>
              {visibleRecentReadingsList.map((item) => {
                const appearance = getReadingCardAppearance(item.site?.type);

                return (
                  <EntityCard
                    key={item.id}
                    style={[appearance.cardStyle, styles.compactReadingCard]}
                    accentStyle={appearance.accentStyle}
                  >
                    <View style={styles.compactReadingHeader}>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{item.site?.name || 'Unknown site'}</Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {(item.submitted_profile?.full_name || item.submitted_profile?.email || '-')} · {formatMaybeTimestamp(item.slot_datetime)}
                        </Text>
                      </View>
                      <View style={styles.statusBadge}>
                        <Text style={styles.statusBadgeText}>{String(item.status || '-').toUpperCase()}</Text>
                      </View>
                    </View>

                    <View style={styles.compactReadingFooter}>
                      <Text style={styles.compactReadingType}>{item.site?.type || '-'}</Text>
                      <Text style={styles.compactReadingMetric}>
                        {item.site?.type === 'DEEPWELL'
                          ? `Flow ${item.flowrate_m3hr ?? '-'}`
                          : `Totalizer ${item.totalizer ?? '-'}`}
                      </Text>
                      <Text style={styles.compactReadingTime}>Saved {formatMaybeTimestamp(item.created_at)}</Text>
                    </View>
                  </EntityCard>
                );
              })}

              {filteredRecentReadings.length > visibleRecentReadings ? (
                <PrimaryButton
                  label={`Show more (${filteredRecentReadings.length - visibleRecentReadings} left)`}
                  onPress={() => setVisibleRecentReadings((current) => current + 3)}
                  tone="secondary"
                  icon={<Ionicons name="chevron-down-outline" size={16} color={palette.ink900} />}
                />
              ) : null}
            </View>
          ) : (
            <MessageBanner tone="info">
              {recentReadingFilter === 'all' && recentReadingDateFilter === 'all'
                ? 'No readings have been submitted yet.'
                : 'No recent readings match the selected filters right now.'}
            </MessageBanner>
          )}
        </Card>

      </View>
    );
  }

  function renderRoles() {
    if (!canManageAccounts) {
      return null;
    }

    return (
      <Card style={styles.panelCard}>
        <SectionHeader
          title="Account roles"
          body="The first admin is still a one-time SQL bootstrap. Admins and general managers can promote or demote accounts here."
          iconName="people-outline"
          iconColor={palette.teal600}
        />

        <View style={styles.rolesTopRow}>
          <Text style={styles.rolesMeta}>
            {filteredProfiles.length} {filteredProfiles.length === 1 ? 'account' : 'accounts'}
          </Text>
          <View style={styles.roleFilterRow}>
            {roleFilterOptions.map((option) => {
              const active = option.key === roleFilter;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setRoleFilter(option.key)}
                  style={[styles.roleFilterChip, active && styles.roleFilterChipActive]}
                >
                  <Ionicons
                    name={option.iconName}
                    size={12}
                    color={active ? palette.onAccent : palette.ink700}
                  />
                  <Text style={[styles.roleFilterChipText, active && styles.roleFilterChipTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {filteredProfiles.length ? (
          <View style={styles.list}>
            {filteredProfiles.map((item) => (
              <EntityCard key={item.id}>
                <View style={styles.entityHeader}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{item.full_name || item.email || 'Unnamed user'}</Text>
                    <Text style={styles.rowMeta}>{item.email || '-'}</Text>
                  </View>
                  <RoleBadge role={item.role} />
                </View>

                <View style={styles.metaStrip}>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillLabel}>Approved</Text>
                    <Text style={styles.metaPillValue}>{item.is_approved ? 'Yes' : 'No'}</Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillLabel}>Created</Text>
                    <Text style={styles.metaPillValue}>{formatMaybeTimestamp(item.created_at)}</Text>
                  </View>
                </View>

                {item.id === profile?.id ? (
                  <MessageBanner tone="info">Current signed-in account.</MessageBanner>
                ) : (
                  <View style={styles.rolePickerWrap}>
                    <Text style={styles.rolePickerLabel}>Change role</Text>
                    <Pressable
                      onPress={() =>
                        setOpenRoleMenuId((current) => (current === item.id ? '' : item.id))
                      }
                      style={({ pressed }) => [
                        styles.roleSelect,
                        openRoleMenuId === item.id && styles.roleSelectOpen,
                        pressed && styles.roleSelectPressed,
                      ]}
                    >
                      <Text style={styles.roleSelectText}>
                        {roleUpdatingId.startsWith(`${item.id}:`) ? 'Updating...' : 'Select role'}
                      </Text>
                      <Ionicons
                        name={openRoleMenuId === item.id ? 'chevron-up' : 'chevron-down'}
                        size={15}
                        color={palette.ink700}
                      />
                    </Pressable>

                    {openRoleMenuId === item.id ? (
                      <View style={styles.roleMenu}>
                        {roleChoices
                          .filter((choice) => choice !== item.role)
                          .map((choice, index) => {
                            const isUpdating = roleUpdatingId === `${item.id}:${choice}`;

                            return (
                              <Pressable
                                key={choice}
                                onPress={() => handleRoleChange(item, choice)}
                                disabled={Boolean(roleUpdatingId)}
                                style={({ pressed }) => [
                                  styles.roleMenuItem,
                                  index === 0 ? styles.roleMenuItemFirst : null,
                                  pressed && !roleUpdatingId ? styles.roleMenuItemPressed : null,
                                ]}
                              >
                                <Text style={styles.roleMenuItemText}>
                                  {isUpdating
                                    ? 'Updating...'
                                    : formatRoleChoiceLabel(choice)}
                                </Text>
                              </Pressable>
                            );
                          })}
                      </View>
                    ) : null}
                  </View>
                )}
              </EntityCard>
            ))}
          </View>
        ) : (
          <MessageBanner tone="info">
            No accounts match the selected role filter right now.
          </MessageBanner>
        )}
      </Card>
    );
  }

  function renderSection() {
    if (activeSection === 'notifications') {
      return renderNotifications();
    }

    if (activeSection === 'approvals') {
      return renderApprovals();
    }

    if (activeSection === 'readings') {
      return renderSlotTimeline();
    }

    if (activeSection === 'roles') {
      return renderRoles();
    }

    return renderOverview();
  }

  return (
    <ScreenShell
      eyebrow="Live Supabase Workspace"
      title={activeSection === 'notifications' ? 'Notification' : 'Dashboard'}
      showMenuButton
      stickyHeader
      statusChips={headerStatusChips}
      refreshing={loading}
      onRefresh={() => loadDashboard()}
    >
      {renderRecordedValuesModal()}

      <Modal
        visible={showApprovalAnimation}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowApprovalAnimation(false)}
      >
        <View style={styles.approvalAnimationOverlay}>
          <View style={styles.approvalAnimationPanel}>
            <LottieView
              source={require('../../assets/PersonApproved.json')}
              autoPlay
              loop={false}
              style={styles.approvalAnimation}
              onAnimationFinish={() => {
                setTimeout(() => setShowApprovalAnimation(false), 700);
              }}
            />
          </View>
        </View>
      </Modal>

      {message ? <MessageBanner tone={tone}>{message}</MessageBanner> : null}

      {loading ? (
        <DashboardSkeleton isAdmin={isAdmin} isWide={isWide} />
      ) : (
        renderSection()
      )}
    </ScreenShell>
  );
}

function createStyles(palette, isDark, responsiveMetrics) {
  return StyleSheet.create(scaleStyleDefinitions({
  approvalAnimationOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(3,10,17,0.82)' : 'rgba(17,35,59,0.42)',
    padding: 24,
  },
  approvalAnimationPanel: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: isDark ? '#27445E' : '#D8E6F5',
    backgroundColor: isDark ? '#07131F' : '#FFFFFF',
    shadowColor: isDark ? '#000000' : '#0F172A',
    shadowOpacity: isDark ? 0.24 : 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  approvalAnimation: {
    width: 190,
    height: 190,
  },
  recordedValuesOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  recordedValuesBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: isDark ? 'rgba(3,10,17,0.78)' : 'rgba(17,35,59,0.44)',
  },
  recordedValuesSheet: {
    maxHeight: '82%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: isDark ? '#27445E' : '#D8E6F5',
    backgroundColor: isDark ? '#07131F' : '#FFFFFF',
    padding: 14,
    shadowColor: isDark ? '#000000' : '#0F172A',
    shadowOpacity: isDark ? 0.28 : 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  recordedValuesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  recordedValuesTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  recordedValuesEyebrow: {
    color: palette.teal600,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  recordedValuesTitle: {
    marginTop: 4,
    color: palette.ink900,
    fontSize: 18,
    fontWeight: '900',
  },
  recordedValuesMeta: {
    marginTop: 4,
    color: palette.ink500,
    fontSize: 11,
    fontWeight: '700',
  },
  recordedValuesClose: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? '#132536' : '#F4F8FC',
  },
  recordedValuesMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  recordedValuesMetaTile: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 132,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? '#102131' : '#F7FBFF',
    padding: 9,
  },
  recordedValuesMetaLabel: {
    color: palette.ink500,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  recordedValuesMetaValue: {
    marginTop: 4,
    color: palette.ink900,
    fontSize: 11,
    fontWeight: '800',
  },
  recordedValuesScroll: {
    marginTop: 12,
  },
  recordedValuesList: {
    gap: 8,
    paddingBottom: 4,
  },
  recordedValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? palette.mist : '#FAFDFF',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  recordedValueRowAlert: {
    borderColor: palette.amber500,
    backgroundColor: isDark ? '#3A2B12' : '#FFF7E6',
  },
  recordedValueLabel: {
    flex: 1,
    color: palette.ink700,
    fontSize: 11,
    fontWeight: '800',
  },
  recordedValueLabelAlert: {
    color: isDark ? '#FDE68A' : '#92400E',
  },
  recordedValueValue: {
    flexShrink: 1,
    color: palette.ink900,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'right',
  },
  recordedValueValueAlert: {
    color: isDark ? '#FBBF24' : '#B45309',
  },
  recordedRemarks: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? '#102131' : '#F7FBFF',
    padding: 10,
  },
  recordedRemarksText: {
    marginTop: 5,
    color: palette.ink900,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  profileCard: {
    paddingVertical: 10,
  },
  quickActionPressed: {
    transform: [{ scale: 0.98 }],
  },
  profileTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  profileActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  profileCopy: {
    flex: 1,
  },
  signOutMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: isDark ? '#A77925' : '#F7D6A7',
    backgroundColor: isDark ? '#3A2910' : '#FFF5E8',
  },
  signOutMiniPressed: {
    transform: [{ scale: 0.98 }],
  },
  signOutMiniLabel: {
    color: isDark ? palette.amber500 : palette.navy900,
    fontSize: 11,
    fontWeight: '800',
  },
  sectionEyebrow: {
    color: isDark ? palette.heroSubtitle : palette.ink500,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionHeader: {
    gap: 3,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    color: palette.ink900,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionBody: {
    color: palette.ink700,
    fontSize: 12,
    lineHeight: 16,
  },
  userName: {
    marginTop: 4,
    color: isDark ? palette.ink900 : palette.navy900,
    fontSize: 16,
    fontWeight: '900',
  },
  userMeta: {
    marginTop: 2,
    color: palette.ink700,
    fontSize: 12,
  },
  sectionStack: {
    gap: 10,
  },
  panelCard: {
    gap: 8,
    padding: 11,
  },
  dashboardSkeletonCard: {
    overflow: 'hidden',
  },
  dashboardSkeletonBlock: {
    backgroundColor: isDark ? '#1C3346' : '#E5EEF6',
    borderRadius: 999,
  },
  dashboardSkeletonHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dashboardSkeletonSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dashboardSkeletonHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  dashboardSkeletonTitle: {
    width: 92,
    height: 14,
  },
  dashboardSkeletonMeta: {
    width: 64,
    height: 12,
  },
  dashboardSkeletonChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dashboardSkeletonChip: {
    width: 78,
    height: 28,
  },
  dashboardSkeletonChipWide: {
    width: 98,
  },
  dashboardSkeletonIcon: {
    width: 24,
    height: 24,
  },
  dashboardSkeletonSmallIcon: {
    width: 22,
    height: 22,
  },
  dashboardSkeletonHeading: {
    width: 142,
    maxWidth: '70%',
    height: 15,
  },
  dashboardSkeletonSubheading: {
    width: 220,
    maxWidth: '86%',
    height: 10,
  },
  dashboardSkeletonTinyLine: {
    width: 54,
    height: 8,
  },
  dashboardSkeletonValue: {
    width: 42,
    height: 18,
    marginTop: 6,
  },
  dashboardSkeletonStatTile: {
    minWidth: 104,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? palette.mist : '#F7FBFF',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  dashboardSkeletonSummaryHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    minWidth: 0,
  },
  dashboardSkeletonSummaryTitle: {
    width: 108,
    maxWidth: '78%',
    height: 12,
  },
  dashboardSkeletonAction: {
    width: 48,
    height: 22,
  },
  dashboardSkeletonSummaryValue: {
    width: 62,
    height: 19,
    marginTop: 4,
  },
  dashboardSkeletonSummaryBody: {
    width: '92%',
    height: 9,
    marginTop: 2,
    borderRadius: 6,
  },
  dashboardSkeletonSummaryBodyShort: {
    width: '62%',
    height: 9,
    borderRadius: 6,
  },
  dashboardSkeletonEntity: {
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? palette.mist : '#FAFDFF',
    padding: 10,
  },
  dashboardSkeletonRowTitle: {
    width: 150,
    maxWidth: '72%',
    height: 13,
  },
  dashboardSkeletonRowMeta: {
    width: 210,
    maxWidth: '88%',
    height: 10,
  },
  dashboardSkeletonBadge: {
    width: 66,
    height: 24,
  },
  dashboardSkeletonMetaPill: {
    minWidth: 96,
    flexGrow: 1,
    height: 45,
    borderRadius: 14,
  },
  statsGrid: {
    marginTop: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  statTile: {
    minWidth: 104,
    flexGrow: 1,
    backgroundColor: isDark ? palette.mist : '#F7FBFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 2,
  },
  statTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statIconTeal: {
    backgroundColor: isDark ? '#123A37' : '#E5F5F3',
    borderColor: isDark ? '#1FAF9E' : '#B4E5DE',
  },
  statIconNavy: {
    backgroundColor: isDark ? '#172A3F' : '#EAF2FB',
    borderColor: isDark ? '#41678A' : '#C9DDF3',
  },
  statIconAmber: {
    backgroundColor: isDark ? '#3A2910' : '#FFF5E8',
    borderColor: isDark ? '#A77925' : '#F7D6A7',
  },
  statIconRose: {
    backgroundColor: isDark ? '#35121C' : '#FFF0F3',
    borderColor: isDark ? '#A84257' : '#FECACA',
  },
  statLabel: {
    color: palette.ink500,
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: {
    marginTop: 2,
    color: isDark ? palette.ink900 : palette.navy900,
    fontSize: 16,
    fontWeight: '900',
  },
  summaryGrid: {
    gap: 6,
  },
  summaryGridWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  summaryCard: {
    gap: 6,
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: isDark ? '#27445E' : '#D8E6F5',
    backgroundColor: isDark ? '#112131' : '#FBFDFF',
    minHeight: 0,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    paddingRight: 6,
  },
  summaryIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? '#16304A' : '#EAF2FB',
    borderWidth: 1,
    borderColor: isDark ? '#31506E' : '#C9DDF3',
  },
  summaryActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: isDark ? '#365A78' : '#BFD7F0',
    backgroundColor: isDark ? '#173047' : '#F2F8FE',
  },
  summaryActionPillText: {
    color: isDark ? palette.ink900 : palette.navy700,
    fontSize: 9,
    fontWeight: '800',
  },
  summaryMetricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryValue: {
    color: isDark ? palette.ink900 : palette.navy900,
    fontSize: 18,
    fontWeight: '900',
  },
  summaryTitle: {
    color: palette.ink900,
    fontSize: 12,
    fontWeight: '800',
  },
  summaryBody: {
    color: palette.ink700,
    fontSize: 10,
    lineHeight: 14,
  },
  list: {
    gap: 6,
  },
  noticeCard: {
    marginTop: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: isDark ? '#A77925' : '#F7D6A7',
    backgroundColor: isDark ? '#3A2910' : '#FFF5E8',
    padding: 10,
    gap: 8,
  },
  noticeCopy: {
    gap: 4,
    flex: 1,
  },
  noticeTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  noticeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  noticeTitle: {
    color: isDark ? palette.warningText : '#8A5308',
    fontSize: 12,
    fontWeight: '800',
  },
  noticeCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: isDark ? '#5A4017' : '#F6DFB8',
  },
  noticeCountText: {
    color: isDark ? palette.warningText : '#8A5308',
    fontSize: 10,
    fontWeight: '900',
  },
  noticeBody: {
    color: isDark ? palette.heroSubtitle : palette.ink700,
    fontSize: 11,
    lineHeight: 15,
  },
  noticeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  noticeAction: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: isDark ? '#4A3514' : '#F6DFB8',
  },
  noticeActionText: {
    color: isDark ? palette.warningText : '#8A5308',
    fontSize: 10,
    fontWeight: '800',
  },
  noticeDismiss: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? '#152636' : '#FFF8ED',
  },
  entityCard: {
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? palette.mist : '#FAFDFF',
    padding: 10,
    overflow: 'hidden',
  },
  entityAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: isDark ? '#2B8D99' : '#8CCFDE',
  },
  readingCardChlorination: {
    backgroundColor: isDark ? '#112A2A' : '#F0FCFF',
    borderColor: isDark ? '#2D8F9C' : '#A8E9F4',
  },
  readingCardDeepwell: {
    backgroundColor: isDark ? '#2F2310' : '#FFF6E8',
    borderColor: isDark ? '#B57A1F' : '#F2C27A',
  },
  entityAccentChlorination: {
    backgroundColor: isDark ? '#39C6D8' : '#26AEC4',
  },
  entityAccentDeepwell: {
    backgroundColor: isDark ? '#F2B44A' : '#E39A22',
  },
  entityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  rowCopy: {
    gap: 2,
    flex: 1,
  },
  rowTitle: {
    color: palette.ink900,
    fontSize: 13,
    fontWeight: '800',
  },
  rowMeta: {
    color: palette.ink700,
    fontSize: 10,
    lineHeight: 13,
  },
  metaStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaPill: {
    minWidth: 96,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? '#152636' : '#F2F8FE',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  metaPillLabel: {
    color: palette.ink500,
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  metaPillValue: {
    marginTop: 2,
    color: isDark ? palette.ink900 : palette.navy900,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
  readingDetails: {
    gap: 2,
  },
  compactReadingCard: {
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  compactReadingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  compactReadingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  compactReadingType: {
    color: palette.ink500,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  compactReadingMetric: {
    color: palette.ink900,
    fontSize: 10,
    fontWeight: '800',
  },
  compactReadingTime: {
    color: palette.ink700,
    fontSize: 10,
    fontWeight: '600',
  },
  roleBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  roleOperator: {
    backgroundColor: isDark ? '#172A3F' : '#EFF6FF',
    borderColor: isDark ? '#41678A' : '#BFDBFE',
  },
  roleSupervisor: {
    backgroundColor: isDark ? '#103228' : '#ECFDF5',
    borderColor: isDark ? '#2F8F72' : '#A7F3D0',
  },
  roleManager: {
    backgroundColor: isDark ? '#3A2910' : '#FFF7ED',
    borderColor: isDark ? '#A77925' : '#FED7AA',
  },
  roleGeneralManager: {
    backgroundColor: isDark ? '#18314A' : '#EEF6FF',
    borderColor: isDark ? '#3B82B8' : '#BAE6FD',
  },
  roleAdmin: {
    backgroundColor: isDark ? '#35121C' : '#FEF2F2',
    borderColor: isDark ? '#A84257' : '#FECACA',
  },
  roleBadgeText: {
    color: isDark ? palette.ink900 : palette.navy900,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  statusBadge: {
    borderRadius: 999,
    backgroundColor: isDark ? '#10313A' : '#E6FBFF',
    borderWidth: 1,
    borderColor: isDark ? '#2B8D99' : '#B7F0F7',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeText: {
    color: isDark ? palette.ink900 : palette.navy900,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  roleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  roleActionItem: {
    minWidth: 120,
    flexGrow: 1,
  },
  rolePickerWrap: {
    gap: 5,
  },
  rolePickerLabel: {
    color: palette.ink500,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  roleSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? palette.mist : '#F8FBFE',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  roleSelectOpen: {
    borderColor: palette.lineStrong,
    backgroundColor: isDark ? '#152636' : '#F2F8FE',
  },
  roleSelectPressed: {
    transform: [{ scale: 0.99 }],
  },
  roleSelectText: {
    color: palette.ink900,
    fontSize: 11,
    fontWeight: '700',
  },
  roleMenu: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  roleMenuItem: {
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  roleMenuItemFirst: {
    borderTopWidth: 0,
  },
  roleMenuItemPressed: {
    backgroundColor: isDark ? '#152636' : '#F4F9FF',
  },
  roleMenuItemText: {
    color: palette.ink900,
    fontSize: 11,
    fontWeight: '700',
  },
  rolesTopRow: {
    gap: 6,
  },
  rolesMeta: {
    color: palette.ink500,
    fontSize: 10,
    fontWeight: '700',
  },
  roleFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  recentReadingFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: -2,
    marginBottom: 2,
  },
  recentReadingControlGroup: {
    gap: 6,
  },
  recentReadingDateGroup: {
    gap: 6,
    marginBottom: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  recentReadingGroupLabel: {
    color: palette.ink500,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  recentReadingDateFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  recentReadingFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: isDark ? '#132131' : '#F3F8FD',
    borderWidth: 1,
    borderColor: palette.line,
  },
  recentReadingFilterChipActive: {
    backgroundColor: palette.navy700,
    borderColor: palette.cyan300,
  },
  recentReadingFilterChipText: {
    color: palette.ink700,
    fontSize: 10,
    fontWeight: '700',
  },
  recentReadingFilterChipTextActive: {
    color: palette.onAccent,
  },
  recentReadingDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: isDark ? '#152636' : '#F2F8FE',
    borderWidth: 1,
    borderColor: palette.line,
  },
  recentReadingDateChipActive: {
    backgroundColor: palette.navy700,
    borderColor: palette.cyan300,
  },
  recentReadingDateChipText: {
    color: palette.ink700,
    fontSize: 9,
    fontWeight: '800',
  },
  recentReadingDateChipTextActive: {
    color: palette.onAccent,
  },
  operationAlertsPanel: {
    gap: 10,
    borderColor: isDark ? '#294C68' : '#BFD4E7',
    backgroundColor: isDark ? '#0C1824' : '#F8FCFF',
  },
  operationAlertsPanelActive: {
    borderColor: isDark ? '#7C5C1D' : '#F2C96D',
  },
  operationAlertScroll: {
    maxHeight: 190,
  },
  operationAlertScrollPeek: {
    maxHeight: 230,
  },
  operationAlertStack: {
    gap: 8,
  },
  operationAlertCard: {
    minHeight: 54,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  operationAlertCardPressed: {
    transform: [{ scale: 0.995 }],
  },
  operationAlertCritical: {
    borderColor: isDark ? '#A84257' : '#F6A6B4',
    backgroundColor: isDark ? '#35121C' : '#FFF0F3',
  },
  operationAlertWarning: {
    borderColor: isDark ? '#A77925' : '#F7D6A7',
    backgroundColor: isDark ? '#3A2910' : '#FFF8E7',
  },
  operationAlertInfo: {
    borderColor: isDark ? '#1D8C91' : '#B5E5E3',
    backgroundColor: isDark ? '#0F2B35' : '#F0FBFA',
  },
  operationAlertCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  operationAlertTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  operationAlertTitle: {
    flex: 1,
    minWidth: 0,
    color: palette.ink900,
    fontSize: 12,
    fontWeight: '900',
  },
  operationAlertMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  operationAlertSeverityPill: {
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(17,35,59,0.14)',
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  operationAlertSeverityText: {
    color: palette.ink900,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  operationAlertDetail: {
    color: palette.ink700,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
  },
  notificationCenter: {
    gap: 12,
  },
  notificationHero: {
    flexDirection: responsiveMetrics.isTablet ? 'row' : 'column',
    alignItems: responsiveMetrics.isTablet ? 'center' : 'stretch',
    gap: 10,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(103,232,249,0.24)' : '#BFD4E7',
    backgroundColor: isDark ? '#07131F' : '#F8FCFF',
    padding: 12,
    borderRadius: 16,
    shadowColor: isDark ? '#38D7C2' : '#0D9488',
    shadowOpacity: isDark ? 0.18 : 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  notificationHeroIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: isDark ? '#1D8C91' : '#8ADCD6',
    backgroundColor: isDark ? '#0D3A4A' : '#E5F8F6',
  },
  notificationHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  notificationHeroTitle: {
    color: palette.ink900,
    fontSize: 16,
    fontWeight: '900',
  },
  notificationHeroBody: {
    marginTop: 3,
    color: palette.ink500,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  markReadButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: isDark ? '#1D8C91' : '#8ADCD6',
    backgroundColor: isDark ? '#0F3A35' : '#E5F8F6',
    paddingHorizontal: 10,
    borderRadius: 10,
    alignSelf: responsiveMetrics.isTablet ? 'auto' : 'stretch',
  },
  markReadText: {
    color: palette.ink900,
    fontSize: 10,
    fontWeight: '900',
  },
  notificationFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  notificationFilterTab: {
    minHeight: 34,
    flex: 1,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: isDark ? '#294C68' : '#BFD4E7',
    backgroundColor: isDark ? '#0C1824' : '#F8FCFF',
    borderRadius: 999,
    paddingHorizontal: 10,
  },
  notificationFilterTabActive: {
    borderColor: palette.cyan300,
    backgroundColor: palette.navy700,
  },
  notificationFilterText: {
    color: palette.ink500,
    fontSize: 10,
    fontWeight: '900',
  },
  notificationFilterTextActive: {
    color: palette.onAccent,
  },
  notificationMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  notificationMetaText: {
    color: palette.ink500,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  notificationStack: {
    gap: 9,
  },
  notificationCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    padding: 12,
    borderRadius: 16,
    backgroundColor: isDark ? '#081624' : '#FFFFFF',
    shadowOpacity: isDark ? 0.18 : 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  notificationCardSuccess: {
    borderColor: isDark ? '#167C65' : '#9EDFD1',
    shadowColor: '#1CC7B4',
  },
  notificationCardWarning: {
    borderColor: isDark ? '#8A6514' : '#F3C66B',
    shadowColor: '#F6C25B',
  },
  notificationCardCritical: {
    borderColor: isDark ? '#803145' : '#F2A5B6',
    shadowColor: '#FB7185',
  },
  notificationCardInfo: {
    borderColor: isDark ? '#1E5B70' : '#B8DDF0',
    shadowColor: '#67E8F9',
  },
  notificationUnreadDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.cyan300,
  },
  notificationIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  notificationIconSuccess: {
    backgroundColor: '#0F766E',
  },
  notificationIconWarning: {
    backgroundColor: '#B45309',
  },
  notificationIconCritical: {
    backgroundColor: '#BE123C',
  },
  notificationIconInfo: {
    backgroundColor: palette.navy700,
  },
  notificationCardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  notificationCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 12,
    minWidth: 0,
  },
  notificationTitle: {
    flex: 1,
    minWidth: 0,
    color: palette.ink900,
    fontSize: 13,
    fontWeight: '900',
  },
  notificationDescription: {
    color: palette.ink700,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  notificationTimestamp: {
    color: palette.ink500,
    fontSize: 10,
    fontWeight: '800',
  },
  notificationBadge: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  notificationBadgeSuccess: {
    backgroundColor: isDark ? '#073C35' : '#E8FFF8',
  },
  notificationBadgeWarning: {
    backgroundColor: isDark ? '#33240B' : '#FFF8E7',
  },
  notificationBadgeCritical: {
    backgroundColor: isDark ? '#35121C' : '#FFF0F3',
  },
  notificationBadgeInfo: {
    backgroundColor: isDark ? '#10243A' : '#EAF6FF',
  },
  notificationBadgeText: {
    color: palette.ink900,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  timelineSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  timelineSummaryTile: {
    minWidth: 94,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? '#152636' : '#F7FBFF',
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  timelineSummaryValue: {
    color: isDark ? palette.ink900 : palette.navy900,
    fontSize: 16,
    fontWeight: '900',
  },
  timelineSummaryLabel: {
    marginTop: 2,
    color: palette.ink500,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  timelineStack: {
    gap: 0,
  },
  timelineSlot: {
    flexDirection: 'row',
    gap: 10,
  },
  timelineMarkerColumn: {
    width: 28,
    alignItems: 'center',
  },
  timelineNode: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    minHeight: 30,
    backgroundColor: isDark ? '#284256' : '#D7E5EF',
  },
  timelineSlotBody: {
    flex: 1,
    gap: 8,
    paddingBottom: 12,
  },
  timelineSlotHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  timelineSlotTitle: {
    color: palette.ink900,
    fontSize: 13,
    fontWeight: '900',
  },
  timelineSlotTime: {
    marginTop: 2,
    color: palette.ink500,
    fontSize: 10,
    fontWeight: '700',
  },
  timelineStatusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  timelineStatusPillText: {
    color: palette.onAccent,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  timelineCheckpointGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  timelineCheckpoint: {
    minWidth: 136,
    flexGrow: 1,
    flexBasis: '48%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? palette.mist : '#FAFDFF',
    padding: 8,
  },
  timelineCheckpointPressable: {
    borderColor: isDark ? '#2F8F72' : '#B9E4D6',
  },
  timelineCheckpointPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  timelineCheckpointIcon: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  timelineCheckpointCopy: {
    flex: 1,
    minWidth: 0,
  },
  timelineCheckpointSite: {
    color: palette.ink900,
    fontSize: 11,
    fontWeight: '800',
  },
  timelineCheckpointMeta: {
    marginTop: 2,
    color: palette.ink700,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
  },
  timelineStatusComplete: {
    backgroundColor: isDark ? '#103228' : '#16A34A',
    borderColor: isDark ? '#2F8F72' : '#15803D',
  },
  timelineStatusDue: {
    backgroundColor: isDark ? '#123A37' : '#0EA5A4',
    borderColor: isDark ? '#1FAF9E' : '#0F766E',
  },
  timelineStatusLate: {
    backgroundColor: isDark ? '#3A2910' : '#F59E0B',
    borderColor: isDark ? '#A77925' : '#B45309',
  },
  timelineStatusMissing: {
    backgroundColor: isDark ? '#35121C' : '#DC2626',
    borderColor: isDark ? '#A84257' : '#991B1B',
  },
  timelineStatusUpcoming: {
    backgroundColor: isDark ? '#24364A' : '#64748B',
    borderColor: isDark ? '#41678A' : '#475569',
  },
  roleFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: isDark ? '#152636' : '#F2F8FE',
  },
  roleFilterChipActive: {
    backgroundColor: palette.navy700,
    borderColor: palette.cyan300,
  },
  roleFilterChipText: {
    color: palette.ink700,
    fontSize: 9,
    fontWeight: '800',
  },
  roleFilterChipTextActive: {
    color: palette.onAccent,
  },
  }, responsiveMetrics, {
    exclude: [
      'recordedValuesSheet.maxHeight',
      'recordedValuesMetaTile.flexBasis',
      'recordedValuesMetaTile.flexGrow',
      'summaryCard.flex',
      'summaryCard.minHeight',
      'entityAccent.left',
      'entityAccent.right',
      'timelineLine.flex',
      'timelineCheckpoint.flexBasis',
      'timelineCheckpoint.flexGrow',
    ],
  }));
}
