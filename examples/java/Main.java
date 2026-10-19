public class Main {
    static int sum(int[] values) {
        int total = 0;
        for (int value : values) {
            if (value > 0) {
                total += value;
            }
        }
        return total;
    }

    public static void main(String[] args) {
        int[] values = {2, 3, 5, 7};
        int result = sum(values);
        System.out.println(result);
    }
}

// Expected output: 17
