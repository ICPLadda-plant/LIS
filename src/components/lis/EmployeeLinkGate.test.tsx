import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "@/context/AuthContext";
import EmployeeLinkGate from "./EmployeeLinkGate";

vi.mock("@/context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockUser = (linkSelfEmployee: ReturnType<typeof vi.fn>) =>
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "unlinked", employeeId: "", email: "achara.b@icpladda.com", roles: ["viewer"] },
    linkSelfEmployee,
  } as unknown as ReturnType<typeof useAuth>);

describe("EmployeeLinkGate", () => {
  it("links by email automatically without asking the user to pick", async () => {
    const linkSelfEmployee = vi.fn().mockResolvedValue(undefined);
    mockUser(linkSelfEmployee);
    render(<EmployeeLinkGate />);
    await waitFor(() => expect(linkSelfEmployee).toHaveBeenCalledTimes(1));
    expect(linkSelfEmployee).toHaveBeenCalledWith();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("explains when HR has no matching email and lets the user retry", async () => {
    const notFound = Object.assign(new Error("ไม่พบอีเมลนี้ในข้อมูลพนักงาน"), { status: 404 });
    const linkSelfEmployee = vi.fn().mockRejectedValueOnce(notFound).mockResolvedValueOnce(undefined);
    mockUser(linkSelfEmployee);
    render(<EmployeeLinkGate />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่พบอีเมลนี้ในข้อมูลพนักงาน");
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    await waitFor(() => expect(linkSelfEmployee).toHaveBeenCalledTimes(2));
  });
});
