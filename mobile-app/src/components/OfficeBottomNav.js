import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getResponsiveMetrics, scaleStyleDefinitions } from '../theme';
import { loadNotificationUnreadCount } from '../utils/notificationState';

const DEFAULT_ITEMS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    iconName: 'grid-outline',
    routeName: 'office-dashboard',
    params: { section: 'overview' },
  },
  {
    key: 'graphs',
    label: 'Graph',
    iconName: 'bar-chart-outline',
    routeName: 'office-graphs',
    params: {},
  },
  {
    key: 'history',
    label: 'History',
    iconName: 'reader-outline',
    routeName: 'reading-history',
    params: { source: 'office-dashboard' },
  },
  {
    key: 'notifications',
    label: 'Notification',
    iconName: 'notifications-outline',
    routeName: 'office-dashboard',
    params: { section: 'notifications' },
  },
];

const ADMIN_ITEMS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    iconName: 'grid-outline',
    routeName: 'office-dashboard',
    params: { section: 'overview' },
  },
  {
    key: 'history',
    label: 'Readings',
    iconName: 'reader-outline',
    routeName: 'office-dashboard',
    params: { section: 'readings' },
  },
  {
    key: 'approvals',
    label: 'Approvals',
    iconName: 'notifications-outline',
    routeName: 'office-dashboard',
    params: { section: 'approvals' },
  },
  {
    key: 'roles',
    label: 'Roles',
    iconName: 'people-outline',
    routeName: 'office-dashboard',
    params: { section: 'roles' },
  },
];
const GENERAL_MANAGER_ITEMS = [
  {
    ...DEFAULT_ITEMS[0],
    params: { section: 'readings' },
  },
  ...DEFAULT_ITEMS.slice(1),
  {
    key: 'approvals',
    label: 'Approvals',
    iconName: 'notifications-outline',
    routeName: 'office-dashboard',
    params: { section: 'approvals' },
  },
  {
    key: 'roles',
    label: 'Roles',
    iconName: 'people-outline',
    routeName: 'office-dashboard',
    params: { section: 'roles' },
  },
];

export default function OfficeBottomNav({ activeKey, navigation, variant = 'office', currentSite }) {
  const { profile } = useAuth();
  const { palette, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const metrics = useMemo(() => getResponsiveMetrics(width), [width]);
  const styles = useMemo(() => createStyles(palette, isDark, metrics), [palette, isDark, metrics]);
  const items = useMemo(() => {
    if (variant === 'operator') {
      return [
        {
          key: 'dashboard',
          label: 'Site',
          iconName: 'location-outline',
          routeName: 'site-selection',
          params: {},
        },
        {
          key: 'history',
          label: 'History',
          iconName: 'reader-outline',
          routeName: 'reading-history',
          params: { siteScope: 'all' },
        },
        {
          key: 'checkpoint',
          label: 'Checkpoint',
          iconName: 'time-outline',
          routeName: 'office-dashboard',
          params: { section: 'readings' },
        },
      ];
    }

    if (profile?.role === 'admin') {
      return ADMIN_ITEMS;
    }

    if (profile?.role === 'general_manager') {
      return GENERAL_MANAGER_ITEMS;
    }

    return DEFAULT_ITEMS;
  }, [currentSite, profile?.role, variant]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const activeScales = useRef({}).current;

  items.forEach((item) => {
    if (!activeScales[item.key]) {
      activeScales[item.key] = new Animated.Value(item.key === activeKey ? 1 : 0);
    }
  });

  useEffect(() => {
    items.forEach((item) => {
      Animated.spring(activeScales[item.key], {
        toValue: item.key === activeKey ? 1 : 0,
        useNativeDriver: true,
        tension: 80,
        friction: 9,
      }).start();
    });
  }, [activeKey, activeScales, items]);

  useEffect(() => {
    let mounted = true;

    async function refreshUnreadCount() {
      const nextCount = await loadNotificationUnreadCount(profile);
      if (mounted) {
        setUnreadNotificationCount(nextCount);
      }
    }

    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeKey, profile?.id, profile?.email]);

  return (
    <View style={styles.navWrap}>
      <View style={styles.navGlow} />
      <View style={styles.navBar}>
        <View pointerEvents="none" style={styles.navBlurLayer} />
        {items.map((item) => {
          const active = activeKey === item.key;
          const animatedScale = activeScales[item.key].interpolate({
            inputRange: [0, 1],
            outputRange: [0.94, 1],
          });
          const animatedOpacity = activeScales[item.key].interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
          });

          return (
            <Pressable
              key={item.key}
              onPress={() => navigation.navigate(item.routeName, item.params)}
              style={({ pressed }) => [
                styles.navItem,
                active && styles.navItemActive,
                pressed && styles.navItemPressed,
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.activePill,
                  {
                    opacity: animatedOpacity,
                    transform: [{ scale: animatedScale }],
                  },
                ]}
              />
              <Ionicons
                name={active ? item.iconName.replace('-outline', '') : item.iconName}
                size={18}
                color={active ? palette.onAccent : palette.ink500}
              />
              {item.key === 'notifications' && unreadNotificationCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                  </Text>
                </View>
              ) : null}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={[styles.navLabel, active && styles.navLabelActive]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function createStyles(palette, isDark, metrics) {
  return StyleSheet.create(scaleStyleDefinitions({
    navWrap: {
      position: 'relative',
      paddingHorizontal: metrics.contentPadding,
      paddingTop: 10,
      paddingBottom: 18,
      backgroundColor: 'transparent',
    },
    navGlow: {
      position: 'absolute',
      left: metrics.contentPadding + 18,
      right: metrics.contentPadding + 18,
      bottom: 15,
      height: 44,
      borderRadius: 999,
      backgroundColor: isDark ? 'rgba(28,199,180,0.18)' : 'rgba(13,148,136,0.14)',
      shadowColor: isDark ? '#38D7C2' : '#0D9488',
      shadowOpacity: isDark ? 0.22 : 0.16,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 0 },
    },
    navBar: {
      width: '100%',
      maxWidth: metrics.contentMaxWidth,
      alignSelf: 'center',
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(103,232,249,0.18)' : 'rgba(158,179,200,0.6)',
      backgroundColor: isDark ? 'rgba(12,24,36,0.84)' : 'rgba(248,252,255,0.84)',
      padding: 6,
      borderRadius: 20,
      overflow: 'hidden',
      shadowColor: isDark ? '#38D7C2' : '#0D9488',
      shadowOpacity: isDark ? 0.18 : 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    navBlurLayer: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.32)',
    },
    navItem: {
      flex: 1,
      minHeight: 46,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      borderRadius: 14,
      paddingHorizontal: 4,
      overflow: 'hidden',
    },
    unreadBadge: {
      position: 'absolute',
      top: 5,
      right: metrics.width < 390 ? 10 : 14,
      minWidth: 16,
      height: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: isDark ? '#0C1824' : '#FFFFFF',
      backgroundColor: palette.amber500,
      paddingHorizontal: 4,
      zIndex: 20,
      elevation: 20,
    },
    unreadBadgeText: {
      color: '#11233B',
      fontSize: 8,
      lineHeight: 10,
      fontWeight: '900',
    },
    navItemActive: {
      backgroundColor: 'transparent',
    },
    navItemPressed: {
      transform: [{ scale: 0.98 }],
    },
    navLabel: {
      color: palette.ink500,
      fontSize: 9,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0,
      textAlign: 'center',
      width: '100%',
    },
    navLabelActive: {
      color: palette.onAccent,
    },
    activePill: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 14,
      backgroundColor: palette.navy700,
    },
  }, metrics, {
    exclude: [
      'navBar.width',
      'navBar.maxWidth',
      'navBar.alignSelf',
      'navBlurLayer.position',
      'navBlurLayer.top',
      'navBlurLayer.right',
      'navBlurLayer.bottom',
      'navBlurLayer.left',
      'activePill.position',
      'activePill.top',
      'activePill.right',
      'activePill.bottom',
      'activePill.left',
      'unreadBadge.position',
      'unreadBadge.zIndex',
      'unreadBadge.elevation',
    ],
  }));
}
