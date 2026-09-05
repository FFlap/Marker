import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider, useAuth } from "@clerk/react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "@/router";
import "@/styles.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) throw new Error("VITE_CONVEX_URL is required");
const convex = new ConvexReactClient(convexUrl);
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPublishableKey)
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required");
const root = document.getElementById("root");
if (!root) throw new Error("Marker root element was not found");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      signInUrl="/login"
      signUpUrl="/login"
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <RouterProvider router={router} />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>,
);
