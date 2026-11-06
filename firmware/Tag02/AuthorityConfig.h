#pragma once
namespace Bid3Config {
// Optional trusted public key supplied by the owner. Empty uses the previously
// USB-enrolled NVS pin. This is never a private key or radio trust-on-first-use.
constexpr char GATEWAY_PUBLIC_KEY_HEX[]="0483d5ecd955b31f12b84cf090b87ea2019122e2b2a257b2fc309cd36dab067fe1c93d5284b921dff24ca1aa739ea3182e35f1dbbb40aeff6de972465151fedfa2";
}
