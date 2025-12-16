import React, { useEffect, useMemo, useState } from "react";
import * as Location from "expo-location";
import { Alert, Button, SafeAreaView, Text, TextInput, View } from "react-native";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

/**
 * Coarse location -> grid key (privacy).
 * We store ONLY this grid key (string), never precise lat/lng.
 */
function gridCellKey(lat: number, lng: number, bandM: number): string {
  const metersPerDegLat = 111_320;
  const latStep = bandM / metersPerDegLat;

  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metersPerDegLng = metersPerDegLat * Math.max(cosLat, 0.01);
  const lngStep = bandM / metersPerDegLng;

  const latIndex = Math.round(lat / latStep);
  const lngIndex = Math.round(lng / lngStep);

  return `grid:${bandM}:${latIndex}:${lngIndex}`;
}

type PresenceRow = {
  user_id: string;
  status: "red" | "orange" | "green";
  band_m: number | null;
  h3_cell: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
};

type NearbyItem = {
  userId: string;
  displayName: string;
  status: "red" | "orange" | "green";
};

type RequestRow = {
  id: string | number; // connect_requests.id is int8/bigint; often comes back as string
  from_user: string;
  to_user: string;
  status: string; // request_status enum
  created_at: string;
  responded_at: string | null;
};

type MatchRow = {
  id: string | number; // matches.id might be bigint/uuid depending on your schema
  user_a: string;
  user_b: string;
  created_at: string;
  request_id?: string | number;
};

type MessageRow = {
  id: string | number; // bigint
  match_id: string | number; // bigint
  sender_user: string;
  body: string;
  created_at: string;
};

export default function App() {
  // Auth + profile
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Presence
  const [status, setStatus] = useState<"red" | "orange" | "green">("red");
  const [bandM, setBandM] = useState<50 | 100 | 200 | 500>(500);
  const [myCell, setMyCell] = useState<string | null>(null);

  // Nearby / requests / matches
  const [nearby, setNearby] = useState<NearbyItem[]>([]);
  const [incoming, setIncoming] = useState<RequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<RequestRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  // Chat
  const [activeMatch, setActiveMatch] = useState<MatchRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messageText, setMessageText] = useState("");

  const userId = session?.user?.id ?? null;
  const isAuthed = !!userId;
  const bandLabel = useMemo(() => `${bandM}m`, [bandM]);

  function showName(id: string) {
    return nameMap[id] || id.slice(0, 6);
  }

  async function loadNames(ids: string[]) {
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (unique.length === 0) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", unique);

    if (error) return;

    const next: Record<string, string> = {};
    (data ?? []).forEach((p: any) => {
      next[p.id] = p.display_name || p.id.slice(0, 6);
    });

    setNameMap((prev) => ({ ...prev, ...next }));
  }

  async function testLocation() {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Location", "Permission not granted.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      Alert.alert("Location OK", `lat: ${pos.coords.latitude}\nlng: ${pos.coords.longitude}`);
    } catch (e: any) {
      Alert.alert("Location error", e?.message ?? String(e));
    }
  }

  async function updatePresence(nextStatus: "red" | "orange" | "green", silent = false) {
    if (!userId) return;
    if (!silent) setLoading(true);

    try {
      const now = new Date();

      if (nextStatus === "red") {
        const expires = new Date(now.getTime() + 10 * 1000);

        const { error } = await supabase.from("presence").upsert(
          {
            user_id: userId,
            status: "red",
            band_m: bandM,
            h3_res: null,
            h3_cell: null,
            last_seen_at: now.toISOString(),
            expires_at: expires.toISOString(),
          },
          { onConflict: "user_id" }
        );
        if (error) throw error;

        setStatus("red");
        setMyCell(null);
        setNearby([]);
        if (!silent) Alert.alert("Sharing updated", "RED (off)");
        return;
      }

      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") throw new Error("Location permission not granted.");

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const cell = gridCellKey(pos.coords.latitude, pos.coords.longitude, bandM);
      const expires = new Date(now.getTime() + 2 * 60 * 1000); // 2 mins (you can change later)

      const { error } = await supabase.from("presence").upsert(
        {
          user_id: userId,
          status: nextStatus,
          band_m: bandM,
          h3_res: null,
          h3_cell: cell,
          last_seen_at: now.toISOString(),
          expires_at: expires.toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;

      setStatus(nextStatus);
      setMyCell(cell);
      if (!silent) Alert.alert("Sharing updated", `${nextStatus.toUpperCase()} • ${bandLabel}`);
    } catch (e: any) {
      if (!silent) Alert.alert("Presence update failed", e?.message ?? String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Keep presence alive every 30s while orange/green
  useEffect(() => {
    if (!userId) return;
    if (status === "red") return;

    const t = setInterval(() => {
      updatePresence(status, true);
    }, 30_000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, status, bandM]);

  async function fetchNearby() {
    if (!userId) return;
    if (!myCell) {
      Alert.alert("Nearby", "Set Orange or Green first to generate your cell.");
      return;
    }

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { data: presenceRows, error } = await supabase
        .from("presence")
        .select("user_id,status,band_m,h3_cell,last_seen_at,expires_at")
        .eq("h3_cell", myCell)
        .neq("user_id", userId)
        .neq("status", "red")
        .gt("expires_at", nowIso)
        .limit(20);

      if (error) throw error;

      const rows = (presenceRows ?? []) as PresenceRow[];
      const ids = rows.map((r) => r.user_id);
      await loadNames(ids);

      const items: NearbyItem[] = rows.map((r) => ({
        userId: r.user_id,
        displayName: showName(r.user_id),
        status: r.status,
      }));

      setNearby(items);
      Alert.alert("Nearby", items.length ? `${items.length} found.` : "No one nearby yet.");
    } catch (e: any) {
      Alert.alert("Nearby error", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchRequestsAndMatches() {
    if (!userId) return;

    setLoading(true);
    try {
      const { data: reqs, error: reqErr } = await supabase
        .from("connect_requests")
        .select("id, from_user, to_user, status, created_at, responded_at")
        .or(`from_user.eq.${userId},to_user.eq.${userId}`)
        .order("created_at", { ascending: false });

      if (reqErr) throw reqErr;

      const all = (reqs ?? []) as RequestRow[];
      setIncoming(all.filter((r) => r.to_user === userId && r.status === "pending"));
      setOutgoing(all.filter((r) => r.from_user === userId && r.status === "pending"));
      await loadNames(all.flatMap((r) => [r.from_user, r.to_user]));

      const { data: ms, error: mErr } = await supabase
        .from("matches")
        .select("id, user_a, user_b, created_at, request_id")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order("created_at", { ascending: false });

      if (mErr) throw mErr;

      const mrows = (ms ?? []) as MatchRow[];
      setMatches(mrows);
      await loadNames(mrows.flatMap((m) => [m.user_a, m.user_b]));
    } catch (e: any) {
      Alert.alert("Load error", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function isRequested(toId: string) {
    return outgoing.some((r) => r.to_user === toId);
  }

  async function sendRequest(toId: string) {
    if (!userId) return;
    if (toId === userId) return;

    setLoading(true);
    try {
      const { error } = await supabase.from("connect_requests").insert({
        from_user: userId,
        to_user: toId,
        status: "pending",
      });

      if (error) {
        if (String(error.code) === "23505") {
          Alert.alert("Request", "You already sent a pending request to this person.");
        } else {
          throw error;
        }
      } else {
        Alert.alert("Request", "Sent.");
      }

      await fetchRequestsAndMatches();
    } catch (e: any) {
      Alert.alert("Send failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function orderedPair(a: string, b: string) {
    return a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a };
  }

  async function acceptRequest(req: RequestRow) {
    if (!userId) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { error: upErr } = await supabase
        .from("connect_requests")
        .update({ status: "accepted", responded_at: nowIso })
        .eq("id", req.id);

      if (upErr) throw upErr;

      const pair = orderedPair(req.from_user, req.to_user);

      // IMPORTANT: your matches table requires request_id
      const { error: mErr } = await supabase.from("matches").insert({
        request_id: String(req.id),
        user_a: pair.user_a,
        user_b: pair.user_b,
      });

      if (mErr && String(mErr.code) !== "23505") throw mErr;

      Alert.alert("Match", "Accepted and matched.");
      await fetchRequestsAndMatches();
    } catch (e: any) {
      Alert.alert("Accept failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function declineRequest(req: RequestRow) {
    if (!userId) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("connect_requests")
        .update({ status: "declined", responded_at: nowIso })
        .eq("id", req.id);

      if (error) throw error;

      Alert.alert("Request", "Declined.");
      await fetchRequestsAndMatches();
    } catch (e: any) {
      Alert.alert("Decline failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function otherUserInMatch(m: MatchRow) {
    if (!userId) return null;
    return m.user_a === userId ? m.user_b : m.user_a;
  }

  // ===== Chat =====

  async function fetchMessages(matchId: string | number) {
    const matchIdStr = String(matchId);

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, match_id, sender_user, body, created_at")
        .eq("match_id", matchIdStr)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw error;

      const rows = (data ?? []) as MessageRow[];
      setMessages(rows);
      await loadNames(rows.map((r) => r.sender_user));
    } catch (e: any) {
      Alert.alert("Messages error", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openChat(m: MatchRow) {
    setActiveMatch(m);
    setMessages([]);
    setMessageText("");
    await fetchMessages(m.id);
  }

  async function sendMessage() {
    if (!userId) return;
    if (!activeMatch) {
      Alert.alert("Chat", "Open a match first.");
      return;
    }

    const body = messageText.trim();
    if (!body) return;

    setLoading(true);
    try {
      const { error } = await supabase.from("messages").insert({
        match_id: String(activeMatch.id),
        sender_user: userId,
        body,
        created_at: new Date().toISOString(),
      });

      if (error) throw error;

      setMessageText("");
      // No manual refresh needed; realtime will append.
    } catch (e: any) {
      Alert.alert("Send failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Live message updates via Realtime (INSERT only)
  useEffect(() => {
    if (!activeMatch?.id) return;

    const matchId = String(activeMatch.id);

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

            // Keep ordered
            next.sort((a: any, b: any) => {
              const ta = new Date(a.created_at).getTime();
              const tb = new Date(b.created_at).getTime();
              return ta - tb;
            });

            return next;
          });

          loadNames([newMsg.sender_user]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch?.id]);

  // ===== Auth wiring =====

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data, error } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
      if (!error && data?.display_name) setDisplayName(data.display_name);
    })();
  }, [userId]);

  async function signUp() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      Alert.alert("Signed up", "Now sign in.");
    } catch (e: any) {
      Alert.alert("Sign up failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function signIn() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setTimeout(fetchRequestsAndMatches, 300);
    } catch (e: any) {
      Alert.alert("Sign in failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    if (!userId) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: userId, display_name: displayName }, { onConflict: "id" });

      if (error) throw error;
      Alert.alert("Saved", "Display name saved.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setNearby([]);
    setIncoming([]);
    setOutgoing([]);
    setMatches([]);
    setActiveMatch(null);
    setMessages([]);
    setMyCell(null);
    setStatus("red");
  }

  // ===== UI =====

  return (
    <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>TrafficLight MVP</Text>

      {!isAuthed ? (
        <View style={{ gap: 10 }}>
          <Text>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
          />

          <Text>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
          />

          <Button title={loading ? "Working..." : "Sign In"} onPress={signIn} disabled={loading} />
          <Button title={loading ? "Working..." : "Sign Up"} onPress={signUp} disabled={loading} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text>Signed in as: {session?.user?.email}</Text>

          <Text>Display name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
          />

          <Button title={loading ? "Saving..." : "Save Profile"} onPress={saveProfile} disabled={loading} />
          <Button title="Test Location" onPress={testLocation} />

          <Text>Status (current: {status.toUpperCase()})</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Red" onPress={() => updatePresence("red")} disabled={loading} />
            <Button title="Orange" onPress={() => updatePresence("orange")} disabled={loading} />
            <Button title="Green" onPress={() => updatePresence("green")} disabled={loading} />
          </View>

          <Text>Band (current: {bandLabel})</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="50" onPress={() => setBandM(50)} disabled={loading} />
            <Button title="100" onPress={() => setBandM(100)} disabled={loading} />
            <Button title="200" onPress={() => setBandM(200)} disabled={loading} />
            <Button title="500" onPress={() => setBandM(500)} disabled={loading} />
          </View>

          <Text>My cell: {myCell ?? "-"}</Text>

          <Button title={loading ? "Checking..." : "Check Nearby"} onPress={fetchNearby} disabled={loading} />
          <Button
            title={loading ? "Loading..." : "Load Requests / Matches"}
            onPress={fetchRequestsAndMatches}
            disabled={loading}
          />

          {nearby.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: "600" }}>Nearby</Text>
              {nearby.map((p) => (
                <View
                  key={p.userId}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                >
                  <Text>
                    {p.displayName} • {p.status.toUpperCase()}
                  </Text>
                  <Button
                    title={isRequested(p.userId) ? "Requested" : "Request"}
                    onPress={() => sendRequest(p.userId)}
                    disabled={loading || isRequested(p.userId)}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {incoming.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: "600" }}>Incoming Requests</Text>
              {incoming.map((r) => (
                <View key={String(r.id)} style={{ gap: 6, borderWidth: 1, padding: 10, borderRadius: 8 }}>
                  <Text>From: {showName(r.from_user)}</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button title="Accept" onPress={() => acceptRequest(r)} disabled={loading} />
                    <Button title="Decline" onPress={() => declineRequest(r)} disabled={loading} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {matches.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: "600" }}>Matches</Text>
              {matches.map((m) => {
                const other = otherUserInMatch(m);
                return (
                  <View
                    key={String(m.id)}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <Text>Matched with: {other ? showName(other) : "Unknown"}</Text>
                    <Button title="Chat" onPress={() => openChat(m)} disabled={loading} />
                  </View>
                );
              })}
            </View>
          ) : null}

          {activeMatch ? (
            <View style={{ gap: 8, borderWidth: 1, padding: 10, borderRadius: 8 }}>
              <Text style={{ fontWeight: "600" }}>
                Chat: {(() => {
                  const other = otherUserInMatch(activeMatch);
                  return other ? showName(other) : "Unknown";
                })()}
              </Text>

              {messages.length > 0 ? (
                <View style={{ gap: 6 }}>
                  {messages.map((msg) => (
                    <Text key={String(msg.id)}>
                      {showName(msg.sender_user)}: {msg.body}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text>No messages yet.</Text>
              )}

              <TextInput
                value={messageText}
                onChangeText={setMessageText}
                placeholder="Type a message..."
                style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
              />
              <Button title={loading ? "Sending..." : "Send"} onPress={sendMessage} disabled={loading} />
              <Button title="Close chat" onPress={() => setActiveMatch(null)} disabled={loading} />
            </View>
          ) : null}

          <Button title="Sign Out" onPress={signOut} />
        </View>
      )}
    </SafeAreaView>
  );
}
