use reqwest::{redirect::Policy, Client, StatusCode};
use serde_json::Value;

#[tauri::command]
pub async fn fetch_rscripts(query: String, page: u32, sort: String) -> Result<Value, String> {
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not initialize the RScripts client.")?;
    let mut request = client
        .get("https://synz-rscripts.xanderbear2019.workers.dev/v1/scripts")
        .query(&[("page", page.to_string()), ("sort", sort)]);
    if !query.is_empty() {
        request = request.query(&[("q", query)]);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Could not reach RScripts.")?;
    match response.status() {
        StatusCode::OK => response
            .json()
            .await
            .map_err(|_| "Invalid RScripts response.".into()),
        StatusCode::TOO_MANY_REQUESTS => {
            Err("RScripts rate limit reached. Retry in a minute.".into())
        }
        status => Err(format!("RScripts request failed ({status}).")),
    }
}
