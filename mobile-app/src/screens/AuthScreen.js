import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Card from '../components/Card';
import FormField from '../components/FormField';
import MessageBanner from '../components/MessageBanner';
import PrimaryButton from '../components/PrimaryButton';
import ScreenShell from '../components/ScreenShell';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getResponsiveMetrics, scaleStyleDefinitions } from '../theme';

export default function AuthScreen({ initialMessage = '', initialTone = 'info' }) {
  const { signIn, signUp, requestPasswordReset, authMessage } = useAuth();
  const { palette, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const responsiveMetrics = useMemo(() => getResponsiveMetrics(width), [width]);
  const styles = useMemo(() => createStyles(palette, isDark, responsiveMetrics), [palette, isDark, responsiveMetrics]);
  const useMobileLoginCard = width < 620;
  const [mode, setMode] = useState('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(initialMessage || authMessage || '');
  const [tone, setTone] = useState(initialMessage ? initialTone : 'info');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);

    const action =
      mode === 'sign-in'
        ? await signIn({ email: email.trim(), password })
        : await signUp({ email: email.trim(), password, fullName: fullName.trim() });

    setLoading(false);
    setTone(action.ok ? 'success' : 'error');
    setMessage(action.message || (action.ok ? 'Success.' : 'Unable to continue.'));
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setTone('error');
      setMessage('Enter your email first so we know where to send the password reset link.');
      return;
    }

    setLoading(true);
    const action = await requestPasswordReset({ email: email.trim() });
    setLoading(false);
    setTone(action.ok ? 'success' : 'error');
    setMessage(action.message || (action.ok ? 'Password reset email sent.' : 'Unable to send reset email.'));
  }

  return (
    <ScreenShell
      eyebrow="Secure access"
      title="Sign in to NemeXus Monitoring"
      subtitle="This Expo app now uses Supabase Auth and a PostgreSQL-backed database so operators and office staff work from the same live data."
      keyboardAware
      keyboardAwareProps={{
        keyboardOpeningTime: 0,
        extraScrollHeight: 84,
        extraHeight: 120,
        enableAutomaticScroll: true,
      }}
    >
      {!useMobileLoginCard ? (
      <Card>
        <View style={styles.cardTitleRow}>
          <View style={styles.cardIconWrap}>
            <Ionicons
              name={mode === 'sign-in' ? 'lock-closed-outline' : 'person-add-outline'}
              size={18}
              color={palette.ink900}
            />
          </View>
          <Text style={styles.cardTitle}>{mode === 'sign-in' ? 'Login' : 'Create account'}</Text>
        </View>
        <Text style={styles.cardBody}>
          Use your work email and password. Registration is reviewed by the office dashboard, and operators cannot access data collection screens until office approval is granted.
        </Text>
      </Card>
      ) : null}

      {message ? <MessageBanner tone={tone}>{message}</MessageBanner> : null}

      <Card style={[styles.formCard, useMobileLoginCard && styles.mobileLoginCard]}>
        {useMobileLoginCard ? (
          <View style={styles.mobileLoginHeader}>
            <View style={styles.mobileBrandMark}>
              <Ionicons name="analytics-outline" size={20} color={palette.teal600} />
            </View>
            <View style={styles.mobileLoginCopy}>
              <Text style={styles.mobileLoginTitle}>NemeXus Dashboard</Text>
              <Text style={styles.mobileLoginSubtitle}>Manager, supervisor, and general manager access</Text>
            </View>
          </View>
        ) : null}

        {mode === 'sign-up' ? (
          <FormField
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            icon={<Ionicons name="person-outline" size={18} color={palette.ink500} />}
          />
        ) : null}
        <FormField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          icon={<Ionicons name="mail-outline" size={18} color={palette.ink500} />}
        />
        <FormField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Minimum 6 characters"
          secureTextEntry
          autoCapitalize="none"
          icon={<Ionicons name="key-outline" size={18} color={palette.ink500} />}
        />

        {mode === 'sign-in' ? (
          <Pressable onPress={handleForgotPassword} style={styles.forgotWrap}>
            <View style={styles.forgotRow}>
              <Ionicons name="help-circle-outline" size={15} color={palette.teal600} />
              <Text style={styles.forgotText}>Forgot password?</Text>
            </View>
          </Pressable>
        ) : null}

        <PrimaryButton
          label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
          onPress={handleSubmit}
          loading={loading}
          disabled={!email.trim() || !password.trim() || (mode === 'sign-up' && !fullName.trim())}
          icon={
            <Ionicons
              name={mode === 'sign-in' && useMobileLoginCard ? 'shield-checkmark-outline' : mode === 'sign-in' ? 'arrow-forward-circle-outline' : 'checkmark-circle-outline'}
              size={18}
              color={palette.onAccent}
            />
          }
        />

        <Pressable onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
          <View style={styles.toggleRow}>
            <Ionicons name="swap-horizontal-outline" size={16} color={palette.navy700} />
            <Text style={styles.toggleText}>
              {mode === 'sign-in'
                ? 'Need an account? Switch to sign up'
                : 'Already have an account? Switch to sign in'}
            </Text>
          </View>
        </Pressable>
      </Card>
    </ScreenShell>
  );
}

function createStyles(palette, isDark, responsiveMetrics) {
  return StyleSheet.create(scaleStyleDefinitions({
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cardIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#16304A' : '#EAF2FB',
      borderWidth: 1,
      borderColor: isDark ? '#31506E' : '#C9DDF3',
    },
    cardTitle: {
      color: palette.ink900,
      fontSize: 19,
      fontWeight: '800',
    },
    cardBody: {
      marginTop: 8,
      color: palette.ink700,
      fontSize: 14,
      lineHeight: 20,
    },
    formCard: {
      gap: 14,
    },
    mobileLoginCard: {
      gap: 18,
      borderRadius: 8,
      padding: 18,
      borderColor: isDark ? '#29465C' : '#C7D8E5',
      backgroundColor: isDark ? '#101B25' : palette.card,
    },
    mobileLoginHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 2,
    },
    mobileBrandMark: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: palette.teal600,
      backgroundColor: isDark ? '#0B1620' : '#F7FCFF',
      borderRadius: 6,
    },
    mobileLoginCopy: {
      flex: 1,
      minWidth: 0,
    },
    mobileLoginTitle: {
      color: palette.ink900,
      fontSize: 22,
      lineHeight: 26,
      fontWeight: '900',
    },
    mobileLoginSubtitle: {
      marginTop: 2,
      color: palette.ink700,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '500',
    },
    forgotWrap: {
      alignSelf: 'flex-end',
    },
    forgotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    forgotText: {
      color: palette.teal600,
      fontSize: 13,
      fontWeight: '700',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    toggleText: {
      color: palette.navy700,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
  }, responsiveMetrics));
}
