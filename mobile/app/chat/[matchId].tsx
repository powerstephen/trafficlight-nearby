import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { AppButton, Muted, Screen } from "../../ui/components";
import { colors, radius, space } from "../../ui/theme";

type MatchRow = {
  id: string | number;
  user_a: string;
  user_b: string;
  created_at: string;
};

type MessageRow = {
  id: string | number;
  match_id: string | number;
  sender_user: string;
  body: string;
  created_at: string;
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ChatDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const matchId = useMemo(() => String(params.matchId ?? ""), [params.matchId]);

  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(false);
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherName, setOtherName] = useState<string>("Chat");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [text, setText] = useState("");

  const listRef = useRef<FlatList<MessageRow>>(null);

  function scrollToEnd() {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }

  async function loadMatchAndOther() {
    if (!userId || !matchId) return;

    const { data, error } = await supabase
      .from("matches")
      .select("id, user_a, user_b, created_at")
      .eq("id", matchId)
      .single();

    if (error) throw error;

    const m = data as MatchRow;
    setMatch(m);

    const other = m.user_a === userId ? m.user_b : m.user_a;
    setOtherUserId(other);

    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", other)
      .single();

    if (!pErr && prof?.display_name) setOtherName(prof.display_name);
    else setOtherName(other.slice(0, 6));
  }

  async function loadMessages() {
    if (!matchId) return;

    const { data, error } = await supabase
      .from("messages")
      .select("id, match_id, sender_user, body, created_at")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true })
      .limit(300);

    if (error) throw error;

    setMessages((data ?? []) as MessageRow[]);
    scrollToEnd();
  }

  async function sendMessage() {
    if (!userId || !matchId) return;

    const body = text.trim();
    if (!body) return;

    setLoading(true);
    try {
      const { error } = await supabase.from("messages").insert({
        match_id: matchId,
        sender_user: userId,
        body,
        created_at: new Date().toISOString(),
      });
      if (error) throw error;

      setText("");
      // Realtime subscription will append; we still scroll.
      scrollToEnd();
    } catch (e: any) {
      Alert.alert("Send failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    if (!userId || !matchId) return;

    (async () => {
      setLoading(true);
      try {
        await loadMatchAndOther();
        await loadMessages();
      } catch (e: any) {
        Alert.alert("Chat load failed", e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, matchId]);

  // Realtime: append new messages for this match
  useEffect(() => {
    if (!matchId) return;

    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;

          setMessages((prev) => {
            const exists = prev.some((m) => String(m.id) === String(newMsg.id));
            if (exists) return prev;

            const next = [...prev, newMsg];
            next.sort(
              (a: any, b: any) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return next;
          });

          scrollToEnd();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  if (!userId) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Muted>Not signed in.</Muted>
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 0, gap: 0 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.headerTitle}>{otherName}</Text>
            <Text style={styles.headerSub}>
              {otherUserId ? otherUserId.slice(0, 6) : ""}
            </Text>
          </View>

          <View style={{ width: 60 }} />
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const mine = item.sender_user === userId;
            return (
              <View
                style={[
                  styles.msgRow,
                  { justifyContent: mine ? "flex-end" : "flex-start" },
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubbleOther,
                  ]}
                >
                  <Text style={[styles.msgText, mine ? { color: "#fff" } : { color: colors.text }]}>
                    {item.body}
                  </Text>
                  <Text style={[styles.time, mine ? { color: "rgba(255,255,255,0.8)" } : { color: colors.muted }]}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ paddingTop: 18 }}>
              <Muted>No messages yet. Say hello.</Muted>
            </View>
          }
        />

        {/* Composer */}
        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
          />
          <View style={{ width: 110 }}>
            <AppButton
              title={loading ? "Sending..." : "Send"}
              onPress={sendMessage}
              disabled={loading || !text.trim()}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    width: 60,
    alignItems: "center",
  },
  backText: {
    fontWeight: "700",
    color: colors.text,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  headerSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },

  listContent: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: 10,
  },
  msgRow: {
    flexDirection: "row",
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderTopRightRadius: 6,
  },
  bubbleOther: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 6,
  },
  msgText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "500",
  },
  time: {
    fontSize: 11,
    marginTop: 6,
    opacity: 0.9,
  },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.text,
  },
});
