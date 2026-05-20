import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import styled from "@emotion/styled";
import Head from "next/head";
import configs from "../../configs/configs";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100vh;
  background-color: #f5f5f5;
`;

const Card = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 30px;
  max-width: 600px;
  width: 90%;
  text-align: center;
`;

const Title = styled.h1`
  color: #333;
  margin-top: 0;
  margin-bottom: 20px;
`;

const ErrorMessage = styled.div`
  color: #d32f2f;
  padding: 15px;
  background-color: #ffebee;
  border-left: 4px solid #d32f2f;
  border-radius: 4px;
  margin: 20px 0;
`;

const CellxgeneFrame = styled.iframe`
  width: 100%;
  height: 100vh;
  border: none;
  margin: 0;
  padding: 0;
`;

/**
 * Route handler for explorer URLs: /e/[id].cxg
 *
 * Launches explorer and displays it embedded in an iframe.
 */
export default function ExplorerRoute() {
  const router = useRouter();
  const { params } = router.query;
  const [cellxgeneUrl, setCellxgeneUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params || params.length === 0) {
      return;
    }

    // Reset state when params change (new dataset selected)
    setCellxgeneUrl(null);
    setError(null);

    const launchCellxgene = () => {
      try {
        let filename = params[0];
        // .cxg: load directly from the single-cell-explorer server
        if (filename.endsWith(".cxg")) {
          const explorerUrl = `${configs.EXPLORER_URL}/e/${filename}`;
          setCellxgeneUrl(explorerUrl);
        } else {
          setError(`Failed to launch Explorer, the file does not have a correct format`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("Error launching Explorer:", err);
        setError(message);
      }
    };

    launchCellxgene();
  }, [params]);

  if (error) {
    return (
      <Container>
        <Card>
          <Title>Error Loading Explorer</Title>
          <ErrorMessage>{error}</ErrorMessage>
        </Card>
      </Container>
    );
  }
  
  return (
    <>
      <Head>
        <title>CELLxGENE | Explorer</title>
      </Head>
      <CellxgeneFrame src={cellxgeneUrl} />
    </>
  );
}
