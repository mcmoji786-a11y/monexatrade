//! A user's own notes on a coin or a wallet (migration 0016): a trader's diary that
//! follows the account to every device. Private: only the owner reads them.
//!
//! `GET /notes` lists the newest 500; `PUT /notes` saves one (an empty body deletes it).

use crate::account::AccountState;
use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

type ApiErr = (StatusCode, String);
const MAX_NOTES: usize = 500;

/// `GET /notes`: the caller's notes, newest first.
pub async fn list(State(a): State<Arc<AccountState>>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    let u = a.user(&headers).await?;
    let v = a.rest(reqwest::Method::GET, &format!("user_notes?user_id=eq.{}&select=kind,ref,label,body,updated_at&order=updated_at.desc&limit={MAX_NOTES}", u.id), None).await?;
    Ok(Json(json!({ "notes": v })))
}

#[derive(Deserialize)]
pub struct NoteIn {
    kind: String,
    #[serde(rename = "ref")]
    target: String,
    #[serde(default)]
    label: String,
    body: String,
}

/// `PUT /notes`: saves one note; an empty body deletes it.
pub async fn save(State(a): State<Arc<AccountState>>, headers: HeaderMap, Json(n): Json<NoteIn>) -> Result<Json<Value>, ApiErr> {
    let u = a.user(&headers).await?;
    if n.kind != "coin" && n.kind != "wallet" {
        return Err((StatusCode::BAD_REQUEST, "a note is on a coin or a wallet".into()));
    }
    if !crate::is_mint(&n.target) {
        return Err((StatusCode::BAD_REQUEST, "not an address".into()));
    }
    let body: String = n.body.chars().filter(|c| !c.is_control() || *c == '\n').collect::<String>().trim().chars().take(2000).collect();
    let filter = format!("user_notes?user_id=eq.{}&kind=eq.{}&ref=eq.{}", u.id, n.kind, n.target);
    if body.is_empty() {
        a.rest(reqwest::Method::DELETE, &filter, None).await?;
        return Ok(Json(json!({ "deleted": true })));
    }
    let count = a.rest(reqwest::Method::GET, &format!("user_notes?user_id=eq.{}&select=ref&limit={}", u.id, MAX_NOTES + 1), None).await?.as_array().map_or(0, |r| r.len());
    let exists = a.rest(reqwest::Method::GET, &format!("{filter}&select=ref"), None).await?.as_array().is_some_and(|r| !r.is_empty());
    if count >= MAX_NOTES && !exists {
        return Err((StatusCode::BAD_REQUEST, format!("You have {MAX_NOTES} notes already; delete some first")));
    }
    let label: String = n.label.chars().filter(|c| !c.is_control()).take(40).collect();
    let row = json!({ "user_id": u.id, "kind": n.kind, "ref": n.target, "label": label.trim(), "body": body, "updated_at": crate::account::chrono_iso(crate::now_unix()) });
    let v = a.rest(reqwest::Method::POST, "user_notes?on_conflict=user_id,kind,ref", Some(row)).await?;
    Ok(Json(json!({ "note": v.as_array().and_then(|r| r.first()).cloned() })))
}
