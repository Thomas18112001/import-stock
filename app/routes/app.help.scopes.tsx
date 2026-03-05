import { BlockStack, Button, Card, List, Page, Text } from "@shopify/polaris";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";

export default function ScopeHelpPage() {
  const embeddedNavigate = useEmbeddedNavigate();

  return (
    <Page
      title="Procédure autorisations Shopify"
      backAction={{ content: "Tableau de bord", onAction: () => embeddedNavigate("/") }}
    >
      <Card>
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            Si vous voyez une erreur d&apos;autorisation (ex: <code>read_metaobject_definitions</code>), appliquez ces
            étapes dans cet ordre.
          </Text>
          <List type="number">
            <List.Item>Exécutez `shopify app config link` dans ce repo.</List.Item>
            <List.Item>Exécutez `shopify app deploy` pour synchroniser la configuration Partner.</List.Item>
            <List.Item>Réinstallez ou réautorisez l&apos;application sur la boutique.</List.Item>
            <List.Item>Redémarrez `shopify app dev` puis rechargez le dashboard.</List.Item>
          </List>
          <Text as="p" variant="bodyMd">
            Verification: `shopify app env show` doit afficher `SCOPES` avec les droits metaobjects attendus.
          </Text>
          <Button onClick={() => embeddedNavigate("/")}>Retour au dashboard</Button>
        </BlockStack>
      </Card>
    </Page>
  );
}



