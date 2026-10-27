import "server-only";
import {
  UnavailableMessagingProvider,
  developmentMocksEnabled,
  type MessagingProvider,
} from "./provider";
import { MockMessagingProvider } from "./mock";
const mock = new MockMessagingProvider(),
  unavailable = new UnavailableMessagingProvider();
export function messagingProvider(): MessagingProvider {
  return developmentMocksEnabled() ? mock : unavailable;
}
