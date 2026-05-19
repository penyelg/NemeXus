import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Card from '../components/Card';
import MessageBanner from '../components/MessageBanner';
import PrimaryButton from '../components/PrimaryButton';
import ScreenShell from '../components/ScreenShell';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getResponsiveMetrics, scaleStyleDefinitions } from '../theme';
import { getOfflineReadingCount, syncOfflineReadings } from '../services/offlineReadings';
import { getReadingForSlot, listReadings } from '../services/readings';
import { listAccessibleSites } from '../services/sites';
import { shiftNameForSlot } from '../utils/shiftSchedule';
import { formatTimestamp, roundDownTo30MinSlot } from '../utils/time';

function getSiteDescription(type) {
  return type === 'CHLORINATION'
    ? 'Residual chlorine, tank level, flowrate, and treatment checks.'
    : 'Pressure, flow, power, and electrical monitoring for the pump station.';
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readingOperatorName(reading) {
  return reading?.submitted_profile?.full_name || reading?.submitted_profile?.email || 'another operator';
}

function SkeletonBlock({ styles, style }) {
  return <View style={[styles.skeletonBlock, style]} />;
}

function CheckpointSkeleton({ styles }) {
  return (
    <View style={styles.pendingCheckpointStack}>
      {[0, 1].map((item) => (
        <Card key={item} style={[styles.checkpointCard, styles.skeletonCard]}>
          <View style={styles.checkpointHeader}>
            <SkeletonBlock styles={styles} style={styles.skeletonIcon} />
            <View style={styles.checkpointCopy}>
              <View style={styles.checkpointTitleRow}>
                <SkeletonBlock styles={styles} style={styles.skeletonTitleLine} />
                <SkeletonBlock styles={styles} style={styles.skeletonBadge} />
              </View>
              <SkeletonBlock styles={styles} style={styles.skeletonBodyLine} />
              <SkeletonBlock styles={styles} style={styles.skeletonShortLine} />
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

function StatusStripSkeleton({ styles }) {
  return (
    <Card style={styles.statusStripCard}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.statusStripItem}>
          <SkeletonBlock styles={styles} style={styles.skeletonTinyLine} />
          <SkeletonBlock styles={styles} style={styles.skeletonValueLine} />
        </View>
      ))}
    </Card>
  );
}

function SiteOptionsSkeleton({ styles }) {
  return (
    <View style={styles.options}>
      {[0, 1].map((item) => (
        <Card key={item} style={[styles.option, styles.skeletonCard]}>
          <View style={styles.optionTopRow}>
            <SkeletonBlock styles={styles} style={styles.skeletonSquareIcon} />
            <View style={styles.optionCopy}>
              <SkeletonBlock styles={styles} style={styles.skeletonOptionTitle} />
              <SkeletonBlock styles={styles} style={styles.skeletonOptionBody} />
              <SkeletonBlock styles={styles} style={styles.skeletonOptionBodyShort} />
            </View>
            <SkeletonBlock styles={styles} style={styles.skeletonBadgeWide} />
          </View>
          <View style={styles.optionMetaRow}>
            <SkeletonBlock styles={styles} style={styles.skeletonPill} />
            <SkeletonBlock styles={styles} style={styles.skeletonPillShort} />
          </View>
        </Card>
      ))}
    </View>
  );
}

export default function SiteSelectionScreen({ navigation, onSelectedSiteChange }) {
  const { profile } = useAuth();
  const { palette, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const responsiveMetrics = useMemo(() => getResponsiveMetrics(width), [width]);
  const styles = useMemo(() => createStyles(palette, isDark, responsiveMetrics), [palette, isDark, responsiveMetrics]);
  const isPrivileged = ['admin', 'supervisor', 'manager', 'general_manager'].includes(profile?.role);
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [offlineCount, setOfflineCount] = useState(0);
  const [message, setMessage] = useState('');
  const [offlineMessage, setOfflineMessage] = useState('');
  const [offlineTone, setOfflineTone] = useState('info');
  const [currentSlot, setCurrentSlot] = useState(() => roundDownTo30MinSlot(new Date()));
  const [currentSlotReading, setCurrentSlotReading] = useState(null);
  const [currentSlotReadingsBySite, setCurrentSlotReadingsBySite] = useState({});
  const [slotReadingsLoading, setSlotReadingsLoading] = useState(false);
  const [checkpointSummary, setCheckpointSummary] = useState({
    completed: 0,
    missing: 0,
    expected: 0,
  });
  const [checkpointLoading, setCheckpointLoading] = useState(false);
  const [connectionOnline, setConnectionOnline] = useState(() => {
    if (typeof navigator === 'undefined') {
      return true;
    }

    return navigator.onLine !== false;
  });
  const pendingCurrentSlotSites = useMemo(
    () => sites.filter((site) => !currentSlotReadingsBySite[String(site.id)]),
    [currentSlotReadingsBySite, sites]
  );

  useEffect(() => {
    let mounted = true;

    async function loadSites() {
      setLoading(true);

      try {
        const nextSites = await listAccessibleSites();
        if (!mounted) {
          return;
        }

        setSites(nextSites);
        setSelectedSite(nextSites[0] || null);
        const nextOfflineCount = await getOfflineReadingCount();
        if (mounted) {
          setOfflineCount(nextOfflineCount);
        }

        if (!nextSites.length) {
          setMessage('No sites were found. Re-run the schema seed if the sites table is empty.');
        }
      } catch (error) {
        if (mounted) {
          setMessage(error.message || 'Failed to load sites.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSites();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    onSelectedSiteChange?.(selectedSite);
  }, [onSelectedSiteChange, selectedSite]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentSlot(roundDownTo30MinSlot(new Date()));
    }, 30000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function' ||
      typeof window.removeEventListener !== 'function'
    ) {
      return undefined;
    }

    function handleOnline() {
      setConnectionOnline(true);
    }

    function handleOffline() {
      setConnectionOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCurrentSlotBySite() {
      if (!sites.length) {
        setCurrentSlotReadingsBySite({});
        return;
      }

      setSlotReadingsLoading(true);

      try {
        const rows = await Promise.all(
          sites.map(async (site) => {
            const reading = await getReadingForSlot({
              siteId: site.id,
              siteType: site.type,
              slotIso: currentSlot.toISOString(),
            });

            return [String(site.id), reading];
          })
        );

        if (!mounted) {
          return;
        }

        setCurrentSlotReadingsBySite(Object.fromEntries(rows));
      } catch {
        if (mounted) {
          setCurrentSlotReadingsBySite({});
        }
      } finally {
        if (mounted) {
          setSlotReadingsLoading(false);
        }
      }
    }

    loadCurrentSlotBySite();

    return () => {
      mounted = false;
    };
  }, [currentSlot, sites]);

  useEffect(() => {
    let mounted = true;

    async function loadCheckpointPreview() {
      if (!selectedSite?.id || !selectedSite?.type) {
        setCurrentSlotReading(null);
        setCheckpointSummary({ completed: 0, missing: 0, expected: 0 });
        return;
      }

      setCheckpointLoading(true);

      try {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const expectedThroughCurrent = Math.floor((currentSlot.getTime() - todayStart.getTime()) / (30 * 60 * 1000)) + 1;
        const expectedBeforeCurrent = Math.max(expectedThroughCurrent - 1, 0);
        const [duplicate, todayReadings] = await Promise.all([
          getReadingForSlot({
            siteId: selectedSite.id,
            siteType: selectedSite.type,
            slotIso: currentSlot.toISOString(),
          }),
          listReadings({
            siteId: selectedSite.id,
            siteType: selectedSite.type,
            fromDate: formatDateValue(todayStart),
            toDate: formatDateValue(todayStart),
            limit: 200,
          }),
        ]);

        if (!mounted) {
          return;
        }

        const savedSlots = new Set(
          todayReadings
            .map((reading) => reading.slot_datetime)
            .filter(Boolean)
            .map((value) => new Date(value).getTime())
        );
        const completedBeforeCurrent = [...savedSlots].filter((time) => time < currentSlot.getTime()).length;
        const completed = [...savedSlots].filter((time) => time <= currentSlot.getTime()).length;

        setCurrentSlotReading(duplicate);
        setCheckpointSummary({
          completed,
          missing: Math.max(expectedBeforeCurrent - completedBeforeCurrent, 0),
          expected: expectedThroughCurrent,
        });
      } catch {
        if (mounted) {
          setCurrentSlotReading(null);
          setCheckpointSummary({ completed: 0, missing: 0, expected: 0 });
        }
      } finally {
        if (mounted) {
          setCheckpointLoading(false);
        }
      }
    }

    loadCheckpointPreview();

    return () => {
      mounted = false;
    };
  }, [currentSlot, selectedSite?.id, selectedSite?.type]);

  async function refreshOfflineCount() {
    const nextCount = await getOfflineReadingCount();
    setOfflineCount(nextCount);
  }

  async function handleSyncOfflineReadings() {
    if (syncingOffline) {
      return;
    }

    setSyncingOffline(true);
    setOfflineTone('info');
    setOfflineMessage('Syncing offline readings...');

    try {
      const result = await syncOfflineReadings();
      await refreshOfflineCount();

      if (result.remaining) {
        setOfflineTone('error');
        setOfflineMessage(
          `${result.synced} offline reading(s) synced. ${result.remaining} still pending. ${
            result.lastError || 'Check the connection and try again.'
          }`
        );
        return;
      }

      const skippedText = result.skipped ? ` ${result.skipped} duplicate slot(s) were already saved.` : '';
      setOfflineTone('success');
      setOfflineMessage(`${result.synced} offline reading(s) synced successfully.${skippedText}`);
    } catch (error) {
      setOfflineTone('error');
      setOfflineMessage(error.message || 'Failed to sync offline readings.');
      await refreshOfflineCount();
    } finally {
      setSyncingOffline(false);
    }
  }

  const showSiteSkeleton = loading && !sites.length;
  const showCheckpointSkeleton = showSiteSkeleton || (slotReadingsLoading && !Object.keys(currentSlotReadingsBySite).length);
  const showStatusSkeleton = showSiteSkeleton || (checkpointLoading && !selectedSite);

  return (
    <ScreenShell
      eyebrow="Operator workspace"
      title="Select site"
      subtitle={`Signed in as ${profile?.full_name || profile?.email || 'User'} (${profile?.role || 'operator'})`}
      showMenuButton
    >
      {showCheckpointSkeleton ? (
        <CheckpointSkeleton styles={styles} />
      ) : selectedSite && checkpointSummary.missing > 0 ? (
        <MessageBanner tone="error">
          {checkpointSummary.missing} earlier checkpoint{checkpointSummary.missing === 1 ? '' : 's'} appear missing today for {selectedSite.name}.
        </MessageBanner>
      ) : selectedSite ? (
        <MessageBanner tone="success">No missed checkpoints detected today for {selectedSite.name}.</MessageBanner>
      ) : null}
      {!showCheckpointSkeleton && pendingCurrentSlotSites.length ? (
        <View style={styles.pendingCheckpointStack}>
          {pendingCurrentSlotSites.map((site) => (
            <Pressable
              key={site.id}
              onPress={() => {
                setSelectedSite(site);
                navigation.navigate('submit-reading', { site });
              }}
              style={({ pressed }) => [
                styles.checkpointCard,
                styles.checkpointCardDue,
                pressed && styles.checkpointCardPressed,
              ]}
            >
              <View style={styles.checkpointHeader}>
                <View style={styles.checkpointIcon}>
                  <Ionicons name="radio-button-on-outline" size={18} color={palette.ink900} />
                </View>
                <View style={styles.checkpointCopy}>
                  <View style={styles.checkpointTitleRow}>
                    <Text style={styles.checkpointSiteName} numberOfLines={1}>{site.name}</Text>
                    <View style={[styles.checkpointStatusBadge, styles.checkpointStatusPending]}>
                      <Text style={styles.checkpointStatusText}>Not submitted</Text>
                    </View>
                  </View>
                  <Text style={styles.checkpointTitle}>Current checkpoint due now</Text>
                  <Text style={styles.checkpointBody}>
                    Slot {formatTimestamp(currentSlot)} 
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.ink500} />
              </View>
            </Pressable>
          ))}
        </View>
      ) : !showCheckpointSkeleton && sites.length ? (
        <MessageBanner tone="success">All sites are submitted for the current checkpoint.</MessageBanner>
      ) : null}

      {showStatusSkeleton ? (
        <StatusStripSkeleton styles={styles} />
      ) : selectedSite ? (
        <Card style={styles.statusStripCard}>
          <View style={styles.statusStripItem}>
            <Text style={styles.statusStripLabel}>Shift</Text>
            <Text style={styles.statusStripValue}>{shiftNameForSlot(currentSlot)}</Text>
          </View>
          <View style={styles.statusStripItem}>
            <Text style={styles.statusStripLabel}>Today</Text>
            <Text style={styles.statusStripValue}>
              {checkpointSummary.completed}/{checkpointSummary.expected}
            </Text>
          </View>
          <View style={styles.statusStripItem}>
            <Text style={styles.statusStripLabel}>Sync</Text>
            <Text style={styles.statusStripValue}>
              {connectionOnline ? 'Online' : 'Offline'}{offlineCount ? ` · ${offlineCount} pending` : ''}
            </Text>
          </View>
        </Card>
      ) : null}
      
      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryIcon}>
            <Ionicons name="compass-outline" size={18} color={palette.ink900} />
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.sectionTitle}>Choose the site for this shift</Text>
            <Text style={styles.sectionBody}>
              Confirm where you are assigned today, then continue to submit a new reading or review recent history.
            </Text>
          </View>
        </View>
      </Card>
      {selectedSite ? (
        <Card style={styles.selectionCard}>
          <View style={styles.selectionHeader}>
            <View style={styles.selectionIcon}>
              <Ionicons
                name={selectedSite.type === 'CHLORINATION' ? 'water-outline' : 'flash-outline'}
                size={16}
                color={palette.ink900}
              />
            </View>
            <View style={styles.selectionCopy}>
              <Text style={styles.selectionTitle}>Ready for {selectedSite.name}</Text>
              <Text style={styles.selectionBody}>
                {selectedSite.type === 'CHLORINATION' ? 'Chlorination line' : 'Deepwell station'}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}
      
      {false && selectedSite ? (
        <Card style={[styles.checkpointCard, currentSlotReading ? styles.checkpointCardComplete : styles.checkpointCardDue]}>
          <View style={styles.checkpointHeader}>
            <View style={styles.checkpointIcon}>
              <Ionicons
                name={currentSlotReading ? 'checkmark-circle-outline' : 'radio-button-on-outline'}
                size={18}
                color={palette.ink900}
              />
            </View>
            <View style={styles.checkpointCopy}>
              <View style={styles.checkpointTitleRow}>
                <Text style={styles.checkpointSiteName} numberOfLines={1}>{selectedSite.name}</Text>
                <View style={[styles.checkpointStatusBadge, currentSlotReading ? styles.checkpointStatusDone : styles.checkpointStatusPending]}>
                  <Text style={styles.checkpointStatusText}>{currentSlotReading ? 'Done' : 'Not submitted'}</Text>
                </View>
              </View>
              <Text style={styles.checkpointTitle}>
                {currentSlotReading ? 'Current checkpoint submitted' : 'Current checkpoint due now'}
              </Text>
              <Text style={styles.checkpointBody}>
                Slot {formatTimestamp(currentSlot)} · {shiftNameForSlot(currentSlot)}
              </Text>
              <Text style={styles.checkpointHint}>
                {checkpointLoading
                  ? 'Checking saved readings...'
                  : currentSlotReading
                    ? `Already saved by ${readingOperatorName(currentSlotReading)}.`
                    : `${selectedSite.name} has no reading saved for this slot yet.`}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      

      

      {message ? <MessageBanner tone={sites.length ? 'info' : 'error'}>{message}</MessageBanner> : null}
      {offlineMessage ? <MessageBanner tone={offlineTone}>{offlineMessage}</MessageBanner> : null}

      {offlineCount ? (
        <Card style={styles.offlineCard}>
          <View style={styles.offlineHeader}>
            <View style={styles.offlineIcon}>
              <Ionicons name="cloud-offline-outline" size={18} color={palette.ink900} />
            </View>
            <View style={styles.offlineCopy}>
              <Text style={styles.offlineTitle}>Offline readings pending</Text>
              <Text style={styles.offlineBody}>
                {offlineCount} saved reading{offlineCount === 1 ? '' : 's'} waiting to sync.
              </Text>
            </View>
          </View>
          <PrimaryButton
            label={syncingOffline ? 'Syncing...' : 'Sync now'}
            onPress={handleSyncOfflineReadings}
            loading={syncingOffline}
            tone="secondary"
            icon={<Ionicons name="sync-outline" size={16} color={palette.ink900} />}
          />
        </Card>
      ) : null}

      {loading ? (
        <SiteOptionsSkeleton styles={styles} />
      ) : (
        <View style={styles.options}>
          {sites.map((site) => {
            const active = selectedSite?.id === site.id;
            return (
              <Pressable
                key={site.id}
                onPress={() => setSelectedSite(site)}
                style={[styles.option, active && styles.optionActive]}
              >
                <View style={[styles.optionAccent, active && styles.optionAccentActive]} />
                <View style={styles.optionTopRow}>
                  <View style={[styles.typeIcon, active && styles.typeIconActive]}>
                    <Ionicons
                      name={site.type === 'CHLORINATION' ? 'water-outline' : 'flash-outline'}
                      size={17}
                      color={active ? palette.onAccent : palette.ink900}
                    />
                  </View>
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{site.name}</Text>
                    <Text style={[styles.optionSubhead, active && styles.optionSubheadActive]}>
                      {getSiteDescription(site.type)}
                    </Text>
                  </View>
                  <View style={[styles.badge, active && styles.badgeActive]}>
                    <Text style={[styles.badgeLabel, active && styles.badgeLabelActive]}>{site.type}</Text>
                  </View>
                </View>
                <View style={styles.optionMetaRow}>
                  <View style={[styles.optionMetaPill, active && styles.optionMetaPillActive]}>
                    <Ionicons
                      name="location-outline"
                      size={12}
                      color={active ? palette.onAccent : palette.ink700}
                    />
                    <Text style={[styles.optionMetaText, active && styles.optionMetaTextActive]}>
                      Site ID {site.id}
                    </Text>
                  </View>
                  <View style={[styles.optionMetaPill, active && styles.optionMetaPillActive]}>
                    <Ionicons
                      name={active ? 'checkmark-circle' : 'ellipse-outline'}
                      size={12}
                      color={active ? palette.onAccent : palette.ink700}
                    />
                    <Text style={[styles.optionMetaText, active && styles.optionMetaTextActive]}>
                      {active ? 'Selected now' : 'Tap to select'}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <PrimaryButton
          label={currentSlotReading ? 'Current slot already saved' : 'Submit current checkpoint'}
          onPress={() => (selectedSite ? navigation.navigate('submit-reading', { site: selectedSite }) : null)}
          disabled={!selectedSite || Boolean(currentSlotReading)}
          icon={<Ionicons name="create-outline" size={16} color={palette.onAccent} />}
        />
        {isPrivileged ? (
          <PrimaryButton
            label="Back to office dashboard"
            onPress={() => navigation.navigate('office-dashboard')}
            tone="secondary"
            icon={<Ionicons name="grid-outline" size={16} color={palette.ink900} />}
          />
        ) : null}
      </View>
    </ScreenShell>
  );
}

function createStyles(palette, isDark, responsiveMetrics) {
  return StyleSheet.create(scaleStyleDefinitions({
    summaryCard: {
      gap: 12,
    },
    summaryHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    summaryIcon: {
      width: 36,
      height: 36,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#16304A' : '#EAF2FB',
      borderWidth: 1,
      borderColor: isDark ? '#31506E' : '#C9DDF3',
    },
    summaryCopy: {
      flex: 1,
    },
    sectionTitle: {
      color: palette.ink900,
      fontSize: 18,
      fontWeight: '800',
    },
    sectionBody: {
      marginTop: 8,
      color: palette.ink700,
      fontSize: 14,
      lineHeight: 20,
    },
    options: {
      gap: 12,
    },
    actions: {
      gap: 12,
    },
    option: {
      backgroundColor: palette.card,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 16,
      overflow: 'hidden',
    },
    optionActive: {
      backgroundColor: palette.navy700,
      borderColor: palette.cyan300,
    },
    optionAccent: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 4,
      backgroundColor: isDark ? '#31506E' : '#D5E8FA',
    },
    optionAccentActive: {
      backgroundColor: palette.cyan300,
    },
    optionTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 10,
    },
    typeIcon: {
      width: 34,
      height: 34,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#152636' : '#EAF2FB',
      borderWidth: 1,
      borderColor: palette.line,
    },
    typeIconActive: {
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderColor: 'rgba(255,255,255,0.18)',
    },
    optionCopy: {
      flex: 1,
      gap: 4,
    },
    optionTitle: {
      color: palette.ink900,
      fontSize: 17,
      fontWeight: '800',
    },
    optionTitleActive: {
      color: palette.onAccent,
    },
    optionSubhead: {
      color: palette.ink700,
      fontSize: 12,
      lineHeight: 17,
    },
    optionSubheadActive: {
      color: palette.heroSubtitle,
    },
    optionMetaRow: {
      marginTop: 12,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    optionMetaPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? '#152636' : '#F2F8FE',
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    optionMetaPillActive: {
      borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    optionMetaText: {
      color: palette.ink700,
      fontSize: 11,
      fontWeight: '700',
    },
    optionMetaTextActive: {
      color: palette.onAccent,
    },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? '#15312D' : '#E8F7F6',
    },
    badgeActive: {
      backgroundColor: isDark ? '#17374D' : '#E6FBFF',
    },
    badgeLabel: {
      color: palette.teal600,
      fontSize: 11,
      fontWeight: '800',
    },
    badgeLabelActive: {
      color: palette.ink900,
    },
    selectionCard: {
      gap: 6,
      backgroundColor: isDark ? '#112B24' : '#ECFCF8',
      borderColor: isDark ? '#1A655E' : '#A7E8DD',
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    selectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    selectionIcon: {
      width: 30,
      height: 30,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#123A37' : '#DDF7F3',
      borderWidth: 1,
      borderColor: isDark ? '#1FAF9E' : '#9EDFD6',
    },
    selectionCopy: {
      flex: 1,
      gap: 1,
    },
    selectionTitle: {
      color: palette.ink900,
      fontSize: 14,
      fontWeight: '800',
    },
    selectionBody: {
      color: palette.ink700,
      fontSize: 11,
      lineHeight: 15,
    },
    checkpointCard: {
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    pendingCheckpointStack: {
      gap: 8,
    },
    checkpointCardPressed: {
      transform: [{ scale: 0.99 }],
    },
    checkpointCardDue: {
      backgroundColor: isDark ? '#182235' : '#F2F6FF',
      borderColor: isDark ? '#334769' : '#C7D7F5',
    },
    checkpointCardComplete: {
      backgroundColor: isDark ? '#112B24' : '#ECFCF8',
      borderColor: isDark ? '#1A655E' : '#A7E8DD',
    },
    checkpointHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    checkpointIcon: {
      width: 34,
      height: 34,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#123A37' : '#DDF7F3',
      borderWidth: 1,
      borderColor: isDark ? '#1FAF9E' : '#9EDFD6',
    },
    checkpointCopy: {
      flex: 1,
      gap: 2,
    },
    checkpointTitleRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    checkpointSiteName: {
      flexShrink: 1,
      color: palette.ink900,
      fontSize: 12,
      fontWeight: '900',
    },
    checkpointStatusBadge: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    checkpointStatusDone: {
      borderColor: isDark ? '#1FAF9E' : '#9EDFD6',
      backgroundColor: isDark ? '#123A37' : '#DDF7F3',
    },
    checkpointStatusPending: {
      borderColor: isDark ? '#8A6514' : '#F7D6A7',
      backgroundColor: isDark ? '#33240B' : '#FFF5E8',
    },
    checkpointStatusText: {
      color: palette.ink900,
      fontSize: 9,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    checkpointTitle: {
      color: palette.ink900,
      fontSize: 15,
      fontWeight: '900',
    },
    checkpointBody: {
      color: palette.ink700,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
    },
    checkpointHint: {
      color: palette.ink500,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '700',
    },
    statusStripCard: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 10,
    },
    statusStripItem: {
      minWidth: 96,
      flexGrow: 1,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: isDark ? palette.mist : '#F4F9FE',
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    statusStripLabel: {
      color: palette.ink500,
      fontSize: 9,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    statusStripValue: {
      marginTop: 3,
      color: palette.ink900,
      fontSize: 12,
      fontWeight: '900',
    },
    offlineCard: {
      gap: 12,
      backgroundColor: isDark ? '#182235' : '#F2F6FF',
      borderColor: isDark ? '#334769' : '#C7D7F5',
    },
    offlineHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    offlineIcon: {
      width: 36,
      height: 36,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#223353' : '#E2EBFF',
      borderWidth: 1,
      borderColor: isDark ? '#435B86' : '#BCD0F3',
    },
    offlineCopy: {
      flex: 1,
      gap: 2,
    },
    offlineTitle: {
      color: palette.ink900,
      fontSize: 15,
      fontWeight: '800',
    },
    offlineBody: {
      color: palette.ink700,
      fontSize: 12,
      lineHeight: 18,
    },
    skeletonCard: {
      backgroundColor: isDark ? '#101E2B' : '#F7FBFF',
      borderColor: palette.line,
    },
    skeletonBlock: {
      backgroundColor: isDark ? '#1B3145' : '#DDEAF6',
      borderRadius: 999,
    },
    skeletonIcon: {
      width: 34,
      height: 34,
      borderRadius: 999,
    },
    skeletonSquareIcon: {
      width: 34,
      height: 34,
      borderRadius: 12,
    },
    skeletonTitleLine: {
      width: 120,
      height: 12,
    },
    skeletonBodyLine: {
      width: '82%',
      height: 14,
      marginTop: 4,
    },
    skeletonShortLine: {
      width: '46%',
      height: 11,
      marginTop: 4,
    },
    skeletonTinyLine: {
      width: 42,
      height: 8,
    },
    skeletonValueLine: {
      width: 64,
      height: 13,
      marginTop: 6,
    },
    skeletonBadge: {
      width: 78,
      height: 20,
    },
    skeletonBadgeWide: {
      width: 86,
      height: 24,
    },
    skeletonOptionTitle: {
      width: '64%',
      height: 15,
    },
    skeletonOptionBody: {
      width: '92%',
      height: 11,
      marginTop: 7,
    },
    skeletonOptionBodyShort: {
      width: '58%',
      height: 11,
      marginTop: 5,
    },
    skeletonPill: {
      width: 92,
      height: 25,
    },
    skeletonPillShort: {
      width: 78,
      height: 25,
    },
  }, responsiveMetrics, { exclude: ['siteAccent.left', 'siteAccent.right'] }));
}
