import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

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
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
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
    if (!userId) return;
    if (!matchId) return;

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
      // Realtime subscription will append the message.
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
            next.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
      <SafeAreaView style={{ flex: 1, padding: 16, justifyContent: "center" }}>
        <Text>Not signed in.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Header */}
        <View style={{ padding: 16, borderBottomWidth: 1, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Button title="Back" onPress={() => router.back()} />
            <Text style={{ fontSize: 18, fontWeight: "700" }}>{otherName}</Text>
            <View style={{ width: 60 }} />
          </View>
          <Text style={{ opacity: 0.6, fontSize: 12 }}>
            Match: {match ? String(match.id) : matchId}
          </Text>
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => {
            const mine = item.sender_user === userId;
            return (
              <View
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <Text style={{ fontSize: 14 }}>{item.body}</Text>
                <Text style={{ opacity: 0.6, fontSize: 11, marginTop: 6 }}>
                  {mine ? "You" : otherName}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={{ opacity: 0.7 }}>No messages yet.</Text>}
        />

        {/* Composer */}
        <View style={{ padding: 16, borderTopWidth: 1, gap: 10 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            style={{ borderWidth: 1, padding: 12, borderRadius: 12 }}
          />
          <Button title={loading ? "Sending..." : "Send"} onPress={sendMessage} disabled={loading || !text.trim()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
